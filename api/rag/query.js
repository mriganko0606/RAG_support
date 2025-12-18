const { queryRAG } = require('../../lib/rag-service');

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { query } = req.body;

    if (!query || !query.trim()) {
      return res.status(400).json({
        error: 'Query is required',
      });
    }

    const result = await queryRAG(query);
    res.json(result);
  } catch (error) {
    console.error('Error processing RAG query:', error);
    
    if (error.message.includes('not initialized')) {
      return res.status(400).json({
        error: error.message,
      });
    }

    res.status(500).json({
      error: `An error occurred while processing your query: ${error.message}`,
    });
  }
};

