// The suggested prompts in the Studio chat panel. Also the keys of the recorded runs the public
// demo replays (src/data/recorded/studio-runs.json), so the server can check what it is given.

export const PROMPT_STARTERS: { label: string; prompt: string }[] = [
  { label: "Who owes us a credit note?", prompt: "Which suppliers owe us a credit note, and for how much? Answer in two or three short lines." },
  { label: "Why are invoices on hold?", prompt: "Which invoices are on hold and why? One line each, then tell me what to do about them." },
  {
    label: "Build a cash plan page",
    prompt: "On my blank page, build a cash plan: what we still have to pay each week by supplier, and a table of the open invoices that fall due in the next 14 days.",
  },
];
