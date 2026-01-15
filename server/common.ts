import type { Request } from "express";


// Terrible thing
export type ExpressRequest = Request<
	Record<string, any> | undefined,
	any, any,
	Record<string, any> | undefined
>;

export class ShouldRetry extends Error {}

export function retryPolicy(req: ExpressRequest) {
	return (err: unknown) => (
		!req.closed &&
		err instanceof ShouldRetry
	);
}
