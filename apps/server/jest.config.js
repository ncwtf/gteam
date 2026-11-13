module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@gteam/shared$': '<rootDir>/../../packages/shared/src/index.ts'
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: false,
      tsconfig: {
        module: 'commonjs',
        esModuleInterop: true
      }
    }]
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node']
};
