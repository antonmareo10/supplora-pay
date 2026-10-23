// How the Studio agents reach Claude on this deployment, decided on the server.
//  - "live": each agent turn is a Claude call through /api/studio/llm (local runs with a key, or a
//    deployment that turns it on with STUDIO_AI_LIVE=1, capped per visitor).
//  - "replay": the keyless public demo. The suggested prompts replay recordings of real Claude runs
//    turn by turn; Studio executes the recorded tool calls against this visitor's dashboard.
//  - "off": no chat panel.
export type StudioAiMode = "live" | "replay" | "off";

export interface StudioAiConfig {
  mode: StudioAiMode;
  /** Claude model id the server uses for live turns (shown in the panel). */
  model: string;
}
