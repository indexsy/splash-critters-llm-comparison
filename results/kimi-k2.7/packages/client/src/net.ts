import type { ClientMsg, Difficulty, ServerMsg } from "@splash/shared";

export class NetClient {
  ws?: WebSocket;
  onMessage: (msg: ServerMsg) => void;
  connected = false;
  latency = 50;
  pendingPong = 0;

  constructor(onMessage: (msg: ServerMsg) => void) {
    this.onMessage = onMessage;
    this.connect();
  }

  connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.ws = new WebSocket(`${protocol}//${location.host}/ws`);
    this.ws.onopen = () => {
      this.connected = true;
      const token = localStorage.getItem("splash_token");
      this.send({ type: "hello", token: token || undefined });
    };
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMsg;
      if (msg.type === "ping") {
        this.send({ type: "pong", t: msg.t });
        return;
      }
      this.onMessage(msg);
    };
    this.ws.onclose = () => {
      this.connected = false;
      setTimeout(() => this.connect(), 2000);
    };
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  setNickname(nickname: string) {
    this.send({ type: "set_nickname", nickname });
  }

  joinQueue(mode: "duel" | "ffa") {
    this.send({ type: "queue_join", mode });
  }

  leaveQueue() {
    this.send({ type: "queue_leave" });
  }

  createRoom(opts: any) {
    this.send({ type: "create_room", opts });
  }

  joinRoom(code: string) {
    this.send({ type: "join_room", code });
  }

  listRooms(mode?: "duel" | "ffa") {
    this.send({ type: "room_list_request", mode });
  }

  leaveRoom() {
    this.send({ type: "leave_room" });
  }

  setSlot(slot: number, kind: "human" | "bot" | "closed", difficulty?: string) {
    this.send({ type: "set_slot", slot, kind, difficulty: difficulty as Difficulty });
  }

  setReady(ready: boolean) {
    this.send({ type: "set_ready", ready });
  }

  startMatch() {
    this.send({ type: "start_match" });
  }

  input(input: any) {
    this.send({ type: "input", input });
  }

  emote(id: number) {
    this.send({ type: "emote", id });
  }

  rematchVote(vote: boolean) {
    this.send({ type: "rematch_vote", vote });
  }

  tutorialComplete() {
    this.send({ type: "tutorial_complete" });
  }
}
