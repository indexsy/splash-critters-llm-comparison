const ADJ = ['Soggy', 'Damp', 'Misty', 'Foamy', 'Bubbly', 'Puddle', 'Drizzle', 'Dewy', 'Rainy', 'Splashy'];
const ANIMALS = ['Otter', 'Frog', 'Duck', 'Newt', 'Toad', 'Heron', 'Piper', 'Minnow', 'Gull', 'Newt'];

export function guestNickname(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)]!;
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]!;
  return `${a}${b}`;
}

export function randomTag(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}
