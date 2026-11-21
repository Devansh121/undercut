import type { CreateLimiter } from './limiter';
import type { Room } from './room';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  LIMITER: DurableObjectNamespace<CreateLimiter>;
  /** Optional JSON overriding room timings (tests shorten them). */
  ROOM_TIMINGS?: string;
  /** Room creations allowed per client address, as "count/windowMs". */
  CREATE_LIMIT?: string;
}
