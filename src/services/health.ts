import { BotClient } from './client';
import { Config } from './config';
import { Database } from './database';
import { Logger } from './logger';
import { Status } from 'discord.js';

/**
 * A static class that exposes an HTTP health endpoint for the bot.
 *
 * The endpoint is intended for container orchestration platforms (Kubernetes
 * liveness/readiness probes, Docker `HEALTHCHECK`, etc.) and monitoring systems
 * to determine whether the bot process is alive and ready to serve traffic.
 *
 * Beyond initialization state, the health snapshot also reflects the **live**
 * status of upstream dependencies:
 * - **Discord**: the gateway WebSocket state (`client.ws.status`) is mapped to
 *   `ok` / `degraded` / `down`. A reconnecting or destroyed client is no longer
 *   reported as healthy, even if it was once ready.
 * - **Database**: a `SELECT 1` round-trip is executed against the TypeORM
 *   `DataSource` on a short cache interval so that a dropped backend connection
 *   surfaces without hammering the database on every probe.
 *
 * Endpoints:
 * - `GET /health`        — Full status report (Discord + Database). Returns 200 when healthy, 503 otherwise.
 * - `GET /health/live`   — Liveness probe. Returns 200 as long as the process is responding. Performs no I/O.
 * - `GET /health/ready`  — Readiness probe. Returns 200 only when both the Discord client is ready and the database is reachable.
 *
 * Configuration is sourced from `Config.current_botcfg.health`. When disabled, no HTTP server is started.
 */
export class Health {
    /**
     * The `Logger` class, used for reporting health service events.
     * @private
     * @static
     * @type {typeof Logger}
     */
    private static logger: typeof Logger = Logger;

    /**
     * The underlying `Bun.serve` server instance, or `null` when the service is disabled or stopped.
     * @private
     * @static
     * @type {(ReturnType<typeof Bun.serve> | null)}
     */
    private static server: ReturnType<typeof Bun.serve> | null = null;

    /**
     * The high-resolution timestamp (milliseconds since the Unix epoch) at which the health service was started.
     * Used to compute the process uptime reported by the `/health` endpoint.
     * @private
     * @static
     * @type {(number | null)}
     */
    private static started_at: number | null = null;

    /**
     * The minimum interval, in milliseconds, between consecutive live database pings.
     * Within this window, the cached result of the previous `SELECT 1` is reused, so that
     * high-frequency probe traffic does not translate into database load.
     * @private
     * @static
     * @type {number}
     */
    private static readonly db_ping_cache_ms = 5_000;

    /**
     * Timestamp (ms) of the last database liveness check, or `null` when no check has run yet.
     * @private
     * @static
     * @type {(number | null)}
     */
    private static db_last_ping_at: number | null = null;

    /**
     * Cached result of the last database liveness check.
     * @private
     * @static
     * @type {boolean}
     */
    private static db_last_alive = false;

    /**
     * Whether a database liveness check is currently in flight. Used to coalesce concurrent probes
     * into a single `SELECT 1` round-trip.
     * @private
     * @static
     * @type {boolean}
     */
    private static db_ping_in_flight = false;

    /**
     * Initializes the health HTTP server using `Bun.serve`.
     *
     * Behavior:
     * - If the `health` configuration is disabled, the server is not started and a debug log is emitted.
     * - Otherwise, a Bun HTTP server is started on the configured port. All requests are routed via `handleRequest`.
     * - On startup failure (e.g. port in use), an error log is emitted and the method resolves without throwing,
     *   so that a failed health endpoint never prevents the bot itself from starting.
     * @public
     * @static
     * @async
     * @returns {Promise<void>}
     */
    public static async init(): Promise<void> {
        const cfg = Config.current_botcfg.health;
        if (!cfg.enabled) {
            this.logger.send('services', 'health', 'debug', 'disabled');
            return;
        }
        try {
            this.started_at = Date.now();
            this.server = Bun.serve({
                port: cfg.port,
                fetch: (req) => this.handleRequest(req),
            });
            this.logger.send('services', 'health', 'info', 'started', { port: cfg.port });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.send('services', 'health', 'error', 'start_failed', { message });
        }
    }

    /**
     * Stops the health HTTP server if it is currently running.
     * Safe to call multiple times; subsequent calls are no-ops.
     * @public
     * @static
     */
    public static stop(): void {
        if (!this.server) return;
        this.server.stop();
        this.server = null;
        this.started_at = null;
        this.logger.send('services', 'health', 'debug', 'stopped');
    }

    /**
     * Performs a live `SELECT 1` round-trip against the database to verify reachability.
     *
     * Results are cached for `db_ping_cache_ms` milliseconds; concurrent callers within the
     * cache window share the same in-flight promise so that bursts of probe traffic produce
     * at most one database round-trip per window. When the datasource is not initialized,
     * the check resolves to `false` without throwing.
     * @private
     * @static
     * @async
     * @returns {Promise<boolean>} `true` when the database answered, `false` otherwise.
     */
    private static async pingDatabase(): Promise<boolean> {
        const data_source = Database.dataSource;
        if (!data_source?.isInitialized) return false;

        const now = Date.now();
        if (
            this.db_last_ping_at !== null &&
            now - this.db_last_ping_at < this.db_ping_cache_ms &&
            !this.db_ping_in_flight
        ) {
            return this.db_last_alive;
        }
        if (this.db_ping_in_flight) {
            return this.db_last_alive;
        }

        this.db_ping_in_flight = true;
        try {
            await data_source.query('SELECT 1');
            this.db_last_alive = true;
        } catch (error) {
            this.db_last_alive = false;
            const message = error instanceof Error ? error.message : String(error);
            this.logger.send('services', 'health', 'error', 'db_ping_failed', { message });
        } finally {
            this.db_last_ping_at = Date.now();
            this.db_ping_in_flight = false;
        }
        return this.db_last_alive;
    }

    /**
     * Maps the Discord gateway WebSocket state to a coarse health signal.
     *
     * - `Status.Ready` (as reported by `client.isReady()`, which also accounts for a destroyed gateway) → `'ok'`
     * - `Status.Disconnected` → `'down'`
     * - Any intermediate state (connecting, reconnecting, resuming, …) → `'degraded'`
     * @private
     * @static
     * @param {Client | undefined} client The Discord.js client.
     * @returns {{ state: 'ok' | 'degraded' | 'down', ws_status: string }} The mapped state and human-readable status name.
     */
    private static mapDiscordState(client: typeof BotClient.client | undefined): {
        state: 'ok' | 'degraded' | 'down';
        ws_status: string;
    } {
        if (!client) return { state: 'down', ws_status: 'uninitialized' };

        const status = client.ws.status as Status;
        const ws_status = Status[status] ?? 'unknown';
        if (client.isReady() && status === Status.Ready) return { state: 'ok', ws_status };
        if (status === Status.Disconnected) return { state: 'down', ws_status };
        return { state: 'degraded', ws_status };
    }

    /**
     * Computes the current health snapshot of the bot.
     *
     * Aggregates the live state of the Discord.js gateway and the TypeORM `DataSource`
     * into a single object suitable for serialization as the `/health` response body.
     * The database reachability is probed via `pingDatabase` (cached).
     * @private
     * @static
     * @async
     * @returns {Promise<{
     *   status: 'ok' | 'degraded' | 'down',
     *   uptime: number | null,
     *   discord: { state: 'ok' | 'degraded' | 'down', ws_status: string, ready: boolean, ping: number | null, user: string | null, guilds: number },
     *   database: { initialized: boolean, alive: boolean },
     * }>} The health snapshot.
     */
    private static async getSnapshot(): Promise<{
        status: 'ok' | 'degraded' | 'down';
        uptime: number | null;
        discord: {
            state: 'ok' | 'degraded' | 'down';
            ws_status: string;
            ready: boolean;
            ping: number | null;
            user: string | null;
            guilds: number;
        };
        database: { initialized: boolean; alive: boolean };
    }> {
        const client = BotClient.client;
        const data_source = Database.dataSource;
        const discord = this.mapDiscordState(client);
        const db_initialized = data_source?.isInitialized ?? false;
        const db_alive = await this.pingDatabase();

        const status: 'ok' | 'degraded' | 'down' = !db_alive ? 'down' : discord.state;
        const uptime = this.started_at ? Math.floor((Date.now() - this.started_at) / 1000) : null;
        const discord_ready = discord.state === 'ok';
        return {
            status,
            uptime,
            discord: {
                state: discord.state,
                ws_status: discord.ws_status,
                ready: discord_ready,
                ping: discord_ready ? client.ws.ping : null,
                user: discord_ready ? (client.user?.tag ?? null) : null,
                guilds: discord_ready ? client.guilds.cache.size : 0,
            },
            database: {
                initialized: db_initialized,
                alive: db_alive,
            },
        };
    }

    /**
     * Request handler for the underlying Bun HTTP server.
     *
     * Routes the request to one of the supported endpoints:
     * - `/health`        → 200 with full JSON snapshot when `status === 'ok'`, 503 otherwise.
     * - `/health/live`   → 200 plain-text response, unconditionally. Performs no I/O.
     * - `/health/ready`  → 200 plain-text when both Discord and database are reachable, 503 otherwise.
     *
     * `/health/live` is intentionally handled without any `await` so that its cost is dominated only by
     * HTTP framing, making it safe to use as a high-frequency liveness probe. The remaining endpoints
     * await the live snapshot which includes a cached database round-trip.
     *
     * Any other path returns 404. Unsupported HTTP methods on the supported paths return 405.
     * @private
     * @static
     * @async
     * @param {Request} req The incoming HTTP request.
     * @returns {Promise<Response>} The HTTP response.
     */
    private static async handleRequest(req: Request): Promise<Response> {
        const url = new URL(req.url);
        let response: Response;

        if (req.method !== 'GET') {
            response = new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
        } else if (url.pathname === '/health/live') {
            response = new Response('OK\n', { status: 200, headers: { 'Content-Type': 'text/plain' } });
        } else if (url.pathname === '/health/ready') {
            const snapshot = await this.getSnapshot();
            const ready = snapshot.discord.state === 'ok' && snapshot.database.alive;
            response = new Response(ready ? 'Ready\n' : 'Not Ready\n', {
                status: ready ? 200 : 503,
                headers: { 'Content-Type': 'text/plain' },
            });
        } else if (url.pathname === '/health') {
            const snapshot = await this.getSnapshot();
            response = Response.json(snapshot, { status: snapshot.status === 'ok' ? 200 : 503 });
        } else {
            response = new Response('Not Found\n', { status: 404, headers: { 'Content-Type': 'text/plain' } });
        }

        this.logger.send('services', 'health', 'debug', 'request', {
            method: req.method,
            path: url.pathname,
            status: response.status,
        });
        return response;
    }
}
