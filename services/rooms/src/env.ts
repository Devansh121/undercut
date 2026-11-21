import type { CreateLimiter } from './limiter';
import type { Room } from './room';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  LIMITER: DurableObjectNamespace<CreateLimiter>;
  /** Optional JSON overriding room timings (tests shorten them). */
  ROOM_TIMINGS?: string;
  /** Room creations allowed per client address, as "count/windowMs". */
  CREATE_LIMIT?: string;
  /** Room creations allowed from all addresses together, as "count/windowMs". Unset: none. */
  GLOBAL_CREATE_LIMIT?: string;
  /** "true": refuse room creation and sockets from pages on another origin. */
  SAME_ORIGIN_ONLY?: string;
}
