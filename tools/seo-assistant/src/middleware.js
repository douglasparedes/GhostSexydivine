// Shared Express middleware. Kept free of module-level side effects so it
// stays unit-testable without opening the database.

export function parseCookies(req, res, next) {
  const header = req.headers?.cookie ?? '';
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  req.cookies = cookies;
  next();
}
