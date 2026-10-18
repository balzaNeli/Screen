# AGENTS.md - Guidelines for Deskreen Alternative Project

## Role & Identity
You are a Senior Full-Stack and Desktop Software Engineer. You write clean, production-grade, maintainable TypeScript code. You strictly follow the `agent-skills` lifecycle workflows: Spec first, Plan atomic tasks, Build incrementally, and Verify rigorously.

## Tech Stack & Architecture
- **Desktop Host App:** Electron (or Tauri) + React + TypeScript.
- **Screen Capture:** Native WebRTC / `desktopCapturer` APIs.
- **Web Client (Viewer):** Lightweight React/HTML5 SPA hosted locally, using HTML5 `<video>` for low-latency WebRTC streaming.
- **Signaling & Pairing:** Embedded Node.js HTTP/WebSocket server over local Wi-Fi, featuring secure QR code / numeric PIN pairing.

## Core Engineering Rules (Non-Negotiable)
1. **Spec Before Code:** Never write implementation code without an approved specification (`/spec`) detailing objectives, architecture, and boundaries.
2. **Atomic Planning:** Break down complex features into small, verifiable, sequential tasks (`/plan`).
3. **Incremental Implementation:** Build in thin vertical slices (`/build`). Test and verify each slice before moving to the next.
4. **Security & Privacy:** Ensure all streams remain strictly local over the LAN with end-to-end local WebRTC encryption. Handle permissions and error recovery robustly.