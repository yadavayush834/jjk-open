export function parseVoice(text) {
  const clean = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/\b(hollow purple|purple|murasaki)\b/.test(clean)) return 'purple';
  if (/\b(unlimited void|infinite void|domain expansion|domain|muryo kusho)\b/.test(clean))
    return 'domain';
  if (/\b(blue|ao)\b/.test(clean)) return 'blue';
  if (/\b(red|aka)\b/.test(clean)) return 'red';
  if (/\b(stop|reset|clear)\b/.test(clean)) return 'reset';
  return null;
}
export class VoiceCommands {
  constructor(onState, onCommand) {
    this.onState = onState;
    this.onCommand = onCommand;
    this.enabled = false;
    this.supported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }
  start() {
    if (!this.supported) {
      this.onState(
        false,
        'Voice commands aren’t supported here. Use the keyboard or hand gestures.',
      );
      return;
    }
    if (this.enabled) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new Recognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';
    this.enabled = true;
    this.recognition.onstart = () => this.onState(true, '');
    this.recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const command = parseVoice(event.results[i][0].transcript);
          if (command) this.onCommand(command);
        }
      }
    };
    this.recognition.onerror = (event) => {
      this.enabled = false;
      clearTimeout(this.timer);
      this.onState(
        false,
        event.error === 'not-allowed'
          ? 'Microphone permission was denied. Hand tracking and keyboard controls still work.'
          : `Voice recognition stopped (${event.error}). Tap the switch to retry.`,
      );
    };
    this.recognition.onend = () => {
      if (this.enabled && !document.hidden)
        this.timer = setTimeout(() => {
          try {
            this.recognition.start();
          } catch {
            this.stop();
          }
        }, 750);
    };
    try {
      this.recognition.start();
    } catch {
      this.stop();
      this.onState(false, 'Could not start voice recognition. Try again.');
    }
  }
  stop() {
    this.enabled = false;
    clearTimeout(this.timer);
    this.recognition?.abort();
    this.recognition = null;
    this.onState(false, '');
  }
}
