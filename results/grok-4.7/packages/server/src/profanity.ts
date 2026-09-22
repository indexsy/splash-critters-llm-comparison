const WORDS = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'piss',
  'slut', 'whore', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'spic',
  'chink', 'kike', 'coon', 'rape', 'rapist', 'nazi', 'hitler',
];

export function isClean(name: string): boolean {
  const n = name.toLowerCase().replace(/[^a-z]/g, '');
  return !WORDS.some((w) => n.includes(w));
}
