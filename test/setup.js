/* eslint-disable no-undef */

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  log: jest.fn(),
};

// IMPORTANT First mock winston
jest.mock("winston", () => ({
  format: {
    colorize: jest.fn(),
    combine: jest.fn(),
    label: jest.fn(),
    timestamp: jest.fn(),
    printf: jest.fn(),
  },
  createLogger: jest.fn().mockReturnValue(logger),
  transports: {
    Console: jest.fn(),
  },
}));
