# Testing

## Philosophy

Tests are **documentation** that happens to be executable. A test should read like a specification of behavior.

## Structure: Arrange -> Act -> Assert

Separate the three phases with blank lines:

```typescript
describe('OrderProcessor', () => {
  describe('submit', () => {
    it('creates an order for a valid request', async () => {
      const request = RequestFixture.valid();
      const processor = buildOrderProcessor();

      const order = await processor.submit(request);

      expect(order.status).toBe(OrderStatus.PENDING);
      expect(order.requestId).toBe(request.id);
    });

    it('rejects invalid requests', async () => {
      const request = RequestFixture.invalid();
      const processor = buildOrderProcessor();

      await expect(processor.submit(request)).rejects.toThrow(InvalidRequestError);
    });
  });
});
```

## What to Test

- **Processors and business logic** — Always. This is the core of the system.
- **Utility/helper functions** — Always. They're pure and easy to test.
- **Tool handlers** — Always. Test the concise/detailed output and error paths through the executor seam.
- **GraphQL client/error mapping** — Test against hand-written fakes (no network), covering success, GraphQL errors, and empty data.

## What NOT to Test

- Simple getters/setters or data classes with no logic.
- Framework boilerplate (middleware wiring, route config, loader setup).
- Third-party library behavior.

## Test Doubles

Prefer **hand-written fakes** over mocking libraries. Fakes are simpler, more readable, and catch interface drift at compile time.

## Quality Gates

**Before committing, ALWAYS run:**
```bash
npm run typecheck && npm run build && npm test && npm run lint
```

<!-- Add per-package gates as needed. Example:
**Per-package gates:**
- **api:** `npm run typecheck && npm run test && npm run lint`
- **webapp:** `npm run test && npm run lint`
-->
