// Runs async tasks one after another, in call order, even when they are started concurrently.
//
// The purchasing agent's create_checkout calls from one assistant turn run concurrently (the tool
// runner awaits them with Promise.all). Each call reads the running total of the run's checkouts,
// creates a PayPal order (a network round trip) and then commits its total. Without this, two carts
// can both read an empty total and both slip past the spending limit. Pure, tested in serialize.test.ts.

export function serializer(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}
