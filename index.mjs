import fs from 'fs';
import puppeteer from 'puppeteer';
import axios from 'axios';
import OpenAI from 'openai';
import chalk from 'chalk'; // pretty colors
import cron from 'node-cron'; // scheduler
import dotenv from 'dotenv';
dotenv.config();

const SESSION_COOKIE = process.env.SESSION_COOKIE;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SMM_API_URL = process.env.SMM_API_URL;
const SMM_API_KEY = process.env.SMM_API_KEY;
const PROCESSED_TWEETS_FILE = 'processed_tweets.json';
const TWITTER_URL = 'https://twitter.com';

const HASHTAG = '$chex';
const SCROLL_AMOUNT = 4; // how much to scroll to find new tweets
const MIN_TIMES_TO_LIKE = 20; // minimum number of likes to order
const MAX_TIMES_TO_LIKE = 30; // maximum number of likes to order
const TIMES_TO_VIEW = 100; // how many impressions to order
const SERVICE_ID = '979';  //  Likes ID
const SERVICE_ID2 = '989'; // Impressions ID
const ENABLE_VIEWS_ORDER = true; // Set to false to disable impressions orders for sub 30 view tweets

const INTERVAL_MINUTES = 200;  // Interval between runs in minutes
const LOG_INTERVAL_SECONDS = 10;  // Define the logging interval in seconds

// Properly initialize the OpenAI API client
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

// Function to create a delay
const delay = (time) => new Promise(resolve => setTimeout(resolve, time));

// Read processed tweets from file
let processedTweets = [];
if (fs.existsSync(PROCESSED_TWEETS_FILE)) {
    const data = fs.readFileSync(PROCESSED_TWEETS_FILE);
    processedTweets = JSON.parse(data);
}

// Function to generate a random number between min and max (inclusive)
const getRandomNumber = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Function to execute the main task
const executeTask = async () => {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    // Set the session cookie
    await page.setCookie({
        name: 'auth_token',
        value: SESSION_COOKIE,
        domain: '.twitter.com',
    });

    // Go to Twitter
    await page.goto(TWITTER_URL, { waitUntil: 'networkidle2' });

    // Search for the hashtag
    await page.goto(`${TWITTER_URL}/search?q=${encodeURIComponent(HASHTAG)}&src=typed_query&f=live`, { waitUntil: 'networkidle2' });

    // Scroll to load tweets
    let tweetData = [];
    for (let i = 0; i < SCROLL_AMOUNT; i++) {
        const tweets = await page.evaluate(() => {
            const tweetElements = Array.from(document.querySelectorAll('article'));
            return tweetElements.map(el => {
                const anchor = el.querySelector('a[href*="/status/"]');
                const tweetTextElement = el.querySelector('div[lang]');
                const tweetText = tweetTextElement ? tweetTextElement.innerText : null;
                // Find the views element
                const viewsElement = Array.from(el.querySelectorAll('div[role="group"] a'))
                    .find(a => a.querySelector('svg path[d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z"]'));
                let views = 0;
                if (viewsElement) {
                    const viewsText = viewsElement.innerText.replace(/[^0-9K]/g, '');
                    if (viewsText.includes('K')) {
                        views = parseFloat(viewsText.replace('K', '')) * 1000;
                    } else {
                        views = parseInt(viewsText, 10);
                    }
                }
                return anchor ? { url: anchor.href, text: tweetText, views } : null;
            }).filter(tweet => tweet !== null);
        });
        tweetData = [...new Set([...tweetData, ...tweets])]; // Remove duplicates
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        await delay(2000); // Wait for new tweets to load
    }

    console.log(chalk.yellow(`Collected ${tweetData.length} tweets:`));
    tweetData.forEach(tweet => {
        console.log(chalk.green(tweet.url));
        console.log(chalk.blue(`Views: ${tweet.views}`));
    });

    // Filter out previously processed URLs
    const newTweetData = tweetData.filter(tweet => !processedTweets.some(processedTweet => processedTweet.url === tweet.url));
    console.log(chalk.cyan(`Collected ${tweetData.length} tweets, ${newTweetData.length} new ones processing now`));

    // Analyze sentiment and send new tweet data to the social media manager API
    for (let { url, text, views } of newTweetData) {
        if (text) {
            // Analyze sentiment
            const sentiment = await analyzeSentiment(text);
            console.log(`Sentiment: ${chalk.blue(sentiment)} for tweet:\n"${chalk.green(text)}"\nViews: ${views}\n`);

            if (sentiment === 'positive' || sentiment === 'neutral') {
                let success1 = true;
                const timesToLike = getRandomNumber(MIN_TIMES_TO_LIKE, MAX_TIMES_TO_LIKE);
                if (views > 30) {
                    success1 = await submitLikesOrder(url, SERVICE_ID, timesToLike);
                    if (success1) {
                        await delay(100); // Avoid rate limiting
            
                        // Add the processed tweet to the list and save to file
                        processedTweets.push({ url, text, sentiment, views });
                        fs.writeFileSync(PROCESSED_TWEETS_FILE, JSON.stringify(processedTweets, null, 2));

                        console.log(chalk.red(`Submitted order to like tweet ${timesToLike} times: ${url}`));
                    }
                } else {
                    console.log(chalk.yellow('Post has 30 or less impressions'));

                     // Conditionally submit views order if ENABLE_VIEWS_ORDER is true
                    if (ENABLE_VIEWS_ORDER && views <= 30) {
                        const success2 = await submitViewsOrder(url, SERVICE_ID2);
                        if (success2) {
                            console.log(chalk.red(`Submitted order for tweet impressions ${TIMES_TO_VIEW} times: ${url}`));

                            success1 = await submitLikesOrder(url, SERVICE_ID, timesToLike);

                            if (success1) {
                                await delay(100); // Avoid rate limiting
                                // Add the processed tweet to the list and save to file
                                processedTweets.push({ url, text, sentiment, views });
                                fs.writeFileSync(PROCESSED_TWEETS_FILE, JSON.stringify(processedTweets, null, 2));

                                console.log(chalk.red(`Submitted order to like tweet ${timesToLike} times: ${url}`));
                            }
                        }
                    }
                }
            } else {
                console.log(`Skipped tweet (negative sentiment towards CHEX): ${url}`);

                // Add the processed tweet to the list and save to file
                processedTweets.push({ url, text, sentiment, views });
                fs.writeFileSync(PROCESSED_TWEETS_FILE, JSON.stringify(processedTweets, null, 2));
            }

            // Add the line separator here
            console.log(chalk.gray('------------------------------------------------------------'));
        }
    }

    await browser.close();

    console.log('Saved all tweets');
    console.log(chalk.green(`New tweets processed: ${newTweetData.length}`));
    console.log(chalk.blue(`Total tweets processed so far: ${processedTweets.length}`));
    console.log(chalk.magenta('------------------------------------------------------------'));
    console.log(chalk.magenta('------------------------------------------------------------'));

    // Start countdown for the next run
    startCountdown();
};

async function analyzeSentiment(text) {
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: `$chex is a crypto token and RWA project, classify the sentiment of this tweet towards $chex as positive, negative, or neutral. Consider the overall message, intent, and any implicit meanings. If the tweet expresses satisfaction in selling or switching away from $chex, classify it as negative. If the tweet in any way says essentially don't buy chex or be careful with it classify it as negative. Here is the tweet:\n\n"${text}"` },
            ],
            max_tokens: 100,
            temperature: 0,
        });

        const sentiment = response.choices[0].message.content.trim().toLowerCase();
        return sentiment.includes('positive') ? 'positive' : sentiment.includes('negative') ? 'negative' : 'neutral';
    } catch (error) {
        if (error instanceof OpenAI.APIError) {
            console.error(chalk.red(`API Error: ${error.message}`));
        } else {
            console.error(chalk.red('Error analyzing sentiment:', error));
        }
        return 'neutral'; // Default to neutral if there's an error
    }
}

async function submitLikesOrder(tweetUrl, serviceId, timesToLike) {
    try {
        const response = await axios.post(SMM_API_URL, {
            key: SMM_API_KEY,
            action: 'add',
            service: serviceId,
            link: tweetUrl,
            quantity: timesToLike
        });

        if (response.data.order) {
            return true;
        } else if (response.data.error && response.data.error.toLowerCase().includes('insufficient balance')) {
            console.error(`Error placing order: ${JSON.stringify(response.data)} - Insufficient balance.`);
            process.exit(1); // Exit the script
        } else {
            console.error(`Error placing order: ${JSON.stringify(response.data)}`);
            return false;
        }
    } catch (error) {
        console.error('Error submitting order:', error.response ? error.response.data : error.message);
        if (error.response && error.response.data.error && error.response.data.error.toLowerCase().includes('insufficient balance')) {
            process.exit(1); // Exit the script
        }
        return false;
    }
}

async function submitViewsOrder(tweetUrl, serviceId) {
    try {
        const response = await axios.post(SMM_API_URL, {
            key: SMM_API_KEY,
            action: 'add',
            service: serviceId,
            link: tweetUrl,
            quantity: TIMES_TO_VIEW
        });

        if (response.data.order) {
            return true;
        } else if (response.data.error && response.data.error.toLowerCase().includes('insufficient balance')) {
            console.error(`Error placing order: ${JSON.stringify(response.data)} - Insufficient balance.`);
            process.exit(1); // Exit the script
        } else {
            console.error(`Error placing order: ${JSON.stringify(response.data)}`);
            return false;
        }
    } catch (error) {
        console.error('Error submitting order:', error.response ? error.response.data : error.message);
        if (error.response && error.response.data.error && error.response.data.error.toLowerCase().includes('insufficient balance')) {
            process.exit(1); // Exit the script
        }
        return false;
    }
}

const startCountdown = () => {
    const nextRunTime = new Date(Date.now() + INTERVAL_MINUTES * 60 * 1000);

    // Countdown timer for the next task
    const countdownInterval = setInterval(() => {
        const now = new Date();
        const countdown = Math.max(0, (nextRunTime - now) / 1000); // Countdown in seconds
        const minutes = Math.floor(countdown / 60);
        const seconds = Math.floor(countdown % 60);
        if (seconds % LOG_INTERVAL_SECONDS === 0) { // Log every LOG_INTERVAL_SECONDS seconds
            console.log(chalk.cyan(`Next task in: ${minutes}m ${seconds}s`));
        }

        if (countdown <= 0) {
            clearInterval(countdownInterval);
            executeTask();
        }
    }, 1000); // Update every second
};

// Run the task immediately when the script starts
executeTask();
