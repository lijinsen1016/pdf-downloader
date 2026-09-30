export function isToday(timestamp: number, now = Date.now()): boolean {
  return new Date(timestamp).toDateString() === new Date(now).toDateString();
}

export function isRecent(timestamp: number, windowMs: number, now = Date.now()): boolean {
  return now - timestamp < windowMs;
}
