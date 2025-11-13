export default function handler(req, res) {
  res.status(200).json({
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'OK' : 'NOT SET',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ? 'OK' : 'NOT SET',
    NOTION_TOKEN: process.env.NOTION_TOKEN ? 'OK' : 'NOT SET',
    NOTION_DB_ID: process.env.NOTION_DB_ID ? 'OK' : 'NOT SET',
  });
}
