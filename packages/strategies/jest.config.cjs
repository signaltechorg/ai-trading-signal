const { createDefaultPreset } = require('ts-jest');

const tsJestPreset = createDefaultPreset({
  tsconfig: {
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    strict: true,
    skipLibCheck: true,
    resolveJsonModule: true,
  },
});

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transform: {
    ...tsJestPreset.transform,
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@tradeclaw/core$': '<rootDir>/../core/src/index.ts',
    '^@tradeclaw/signals$': '<rootDir>/../signals/src/index.ts',
  },
};
