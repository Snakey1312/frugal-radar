// Temporary minimal function to isolate Vercel runtime vs app bundle failures.
module.exports = (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, url: req.url }));
};
