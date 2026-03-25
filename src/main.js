/**
 * Apify Actor entry point.
 * Starts the MCP server on the Actor's web server port.
 */
const app = require('./server');

const PORT = process.env.ACTOR_WEB_SERVER_PORT || process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`smart-commit-changelog Apify Actor running on port ${PORT}`);
});
