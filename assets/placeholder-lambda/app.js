exports.handler = async () => ({
  statusCode: 503,
  body: JSON.stringify({ message: 'Deploy application code via CI' }),
});
