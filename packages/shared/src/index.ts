/**
 * @dsh-teamwork/shared — what the clients written in TypeScript agree about:
 * the languages the product ships in and how a person's preference picks
 * one, and the marks of the model providers and how a model finds its own.
 * Isomorphic: nothing here may reach for Node, the DOM or React. The
 * wire is `api/openapi.yaml`, not this package.
 */

export * from './locales';
export * from './providers';
