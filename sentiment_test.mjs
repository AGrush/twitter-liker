import OpenAI from 'openai';
import chalk from 'chalk';
import dotenv from 'dotenv';
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Properly initialize the OpenAI API client
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

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

// Replace this text with the tweet you want to analyze
const tweetText = `
With $2B+ DEAL FLOWS For YE, #CHEX Is Just Warming Up!
Ultra-High-Net-Worth Individuals in Asia are gearing up to flood the digital asset market in the next two years. 
  $CHEX =Billions
`;

(async () => {
    const sentiment = await analyzeSentiment(tweetText);
    console.log(`Sentiment: ${chalk.blue(sentiment)} for tweet:\n"${chalk.green(tweetText)}"\n`);
})();
