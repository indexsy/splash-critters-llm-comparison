/** Tiny text-entry state machine for canvas text fields. */
export class TextInput {
  value = "";

  constructor(
    public maxLen: number,
    private allowed: RegExp = /^[a-zA-Z0-9 _\-]$/
  ) {}

  handleKey(code: string, key: string): boolean {
    if (code === "Backspace") {
      this.value = this.value.slice(0, -1);
      return true;
    }
    if (key.length === 1 && this.allowed.test(key) && this.value.length < this.maxLen) {
      this.value += key;
      return true;
    }
    return false;
  }
}
