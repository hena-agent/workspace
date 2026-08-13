/// <reference types="@solidjs/start/env" />

import type { Actor } from "@hena/console-core/actor.js"

declare global {
  namespace App {
    interface RequestEventLocals {
      actor?: Promise<Actor.Info>
    }
  }
}
