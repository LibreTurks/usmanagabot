const pending = new Map<string, Promise<unknown>>();

/**
 * Serializes asynchronous operations that share the same key so their
 * read-modify-write sequences never interleave. The queue is kept in-process,
 * which is sufficient here because every gateway event for a given message is
 * delivered to a single process.
 *
 * @template T The resolved type of the operation.
 * @param key The key whose operations must run one at a time.
 * @param operation The asynchronous operation to run once the key is free.
 * @returns {Promise<T>} The result of the operation.
 */
export const withLock = <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const previous = pending.get(key) ?? Promise.resolve();
    const chain = previous.then(operation, operation);
    pending.set(key, chain);
    const cleanup = (): void => {
        if (pending.get(key) === chain) pending.delete(key);
    };
    chain.then(cleanup, cleanup);
    return chain;
};
