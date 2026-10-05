/**
 * Wire helpers for the /skill-switch JSON API: bounded body reading, response
 * writing, and the shared error envelope. Every API method returns
 * `{ok: true, value}` on success and `{ok: false, error: {code, message}}`
 * (HTTP 4xx/5xx matching the code) on failure.
 *
 * The shape mirrors the DSH /api gateway contract so the client half's fetch
 * wrapper stays a thin one.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/** Machine-readable error codes of the skill-switch API. */
export type SwitchErrorCode = 'bad-request' | 'not-found' | 'forbidden' | 'conflict' | 'protected' | 'fs-error' | 'internal';
/** One API failure with its wire code and HTTP status. */
export declare class SwitchError extends Error {
    readonly code: SwitchErrorCode;
    readonly status: number;
    constructor(code: SwitchErrorCode, message: string, status?: number);
}
/** Success envelope of one API method. */
export interface SwitchOk<T> {
    ok: true;
    value: T;
}
/** Failure envelope of one API method. */
export interface SwitchErr {
    ok: false;
    error: {
        code: SwitchErrorCode;
        message: string;
    };
}
/** Read and parse the JSON request body (bounded; malformed → bad-request). */
export declare function readJsonBody(req: IncomingMessage): Promise<unknown>;
/** Write a JSON response with the given status. */
export declare function writeJson(res: ServerResponse, status: number, body: unknown): void;
/** Write the success envelope. */
export declare function writeOk(res: ServerResponse, value: unknown): void;
/** Write the failure envelope for any thrown value (unknown → internal 500). */
export declare function writeError(res: ServerResponse, error: unknown): void;
/** Narrow an unknown payload value to a non-empty string, else throw bad-request. */
export declare function requireString(payload: unknown, key: string): string;
/** Narrow an unknown payload value to a string (empty allowed), else throw bad-request. */
export declare function optionalString(payload: unknown, key: string): string;
/** Narrow an unknown payload value to a boolean, else throw bad-request. */
export declare function requireBoolean(payload: unknown, key: string): boolean;
