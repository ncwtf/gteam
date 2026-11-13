import assert from 'node:assert/strict';
import test from 'node:test';
import { getApiErrorMessage } from '../src/lib/apiError.ts';
import { deletionFailure, isMissingKeychainError } from '../src/lib/keychainErrors.ts';
import {
  captureLegacyTokens,
  emailFromJwt,
  reloginPrefill,
  tokenFromSecureRecord,
  tokensInPersistedJson
} from '../src/lib/legacySession.ts';
import { restoreConnection } from '../src/lib/session.ts';

function jwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `eyJhbGciOiJub25lIn0.${body}.sig`;
}

const windowsMissing = 'Failed to delete token: No matching entry found in secure storage';

test('Tauri string rejections keep the keyring text instead of the generic fallback', () => {
  assert.equal(getApiErrorMessage(windowsMissing, '删除登录状态失败'), windowsMissing);
  assert.equal(isMissingKeychainError(windowsMissing), true);
  assert.equal(deletionFailure(windowsMissing), null);
});

test('Windows Credential Manager not-found is treated as already deleted', () => {
  const wrapped = 'Failed to delete token: Platform secure storage failure: Windows ERROR_NOT_FOUND';
  const element = 'Element not found';
  assert.equal(deletionFailure(new Error(wrapped)), null);
  assert.equal(deletionFailure({ message: element }), null);
  assert.equal(deletionFailure('Windows ERROR_NOT_FOUND'), null);
  assert.equal(deletionFailure('Platform secure storage failure: Windows error code 1168'), null);
});

test('a locked keychain is still reported', () => {
  const locked = "Couldn't access platform secure storage: Windows ERROR_NO_SUCH_LOGON_SESSION";
  assert.equal(isMissingKeychainError(locked), false);
  assert.equal(deletionFailure(locked), locked);
  assert.equal(deletionFailure(undefined), '删除登录状态失败');
});

test('empty persisted tokens are not migrated', () => {
  const raw = JSON.stringify({
    state: {
      connections: [{
        id: 'http://192.168.1.200:3000-akuma',
        serverUrl: 'http://192.168.1.200:3000',
        teamName: 'qkk.local',
        userName: 'akuma',
        token: ''
      }],
      activeConnectionId: 'http://192.168.1.200:3000-akuma'
    },
    version: 0
  });
  assert.deepEqual(tokensInPersistedJson(raw), []);
  assert.deepEqual(
    reloginPrefill({ serverUrl: 'http://192.168.1.200:3000', userName: 'akuma' }),
    { serverUrl: 'http://192.168.1.200:3000', email: '' }
  );
});

test('a token still stored by an older client is captured with the email inside the jwt', () => {
  const token = jwt({ userId: '1', email: 'akuma@qkk.local' });
  const storage = {
    getItem(key: string) {
      if (key === 'teamctx-storage') {
        return JSON.stringify({
          state: { connections: [{ serverUrl: 'http://192.168.1.200:3000/', token: 'stale' }] }
        });
      }
      if (key === 'gteam-storage') {
        return JSON.stringify({
          state: { connections: [{ serverUrl: 'http://192.168.1.200:3000', token }] }
        });
      }
      return null;
    }
  };
  assert.deepEqual(captureLegacyTokens(storage), [{
    serverUrl: 'http://192.168.1.200:3000',
    token,
    email: 'akuma@qkk.local'
  }]);
  assert.equal(emailFromJwt('not-a-jwt'), undefined);
  assert.deepEqual(
    reloginPrefill({ serverUrl: 'http://192.168.1.200:3000', email: 'akuma@qkk.local', userName: 'akuma' }),
    { serverUrl: 'http://192.168.1.200:3000', email: 'akuma@qkk.local' }
  );
});

test('an existing connection with no token asks for login instead of calling the API', async () => {
  const restored = await restoreConnection({
    serverUrl: 'http://192.168.1.200:3000',
    token: '',
    email: ''
  }, []);
  assert.deepEqual(restored, { status: 'missing', notice: null });
});

test('a leftover token is kept and the email is read from the jwt', async () => {
  const token = jwt({ userId: '1', email: 'akuma@qkk.local' });
  const restored = await restoreConnection(
    { serverUrl: 'http://192.168.1.200:3000', token: '' },
    [{ serverUrl: 'http://192.168.1.200:3000/', token, email: 'akuma@qkk.local' }]
  );
  assert.equal(restored.status, 'ready');
  if (restored.status !== 'ready') return;
  assert.equal(restored.token, token);
  assert.equal(restored.email, 'akuma@qkk.local');
  assert.match(restored.notice || '', /密钥链/);
});

test('expired secure-store tokens are skipped and a display name that is an email can prefill login', () => {
  assert.equal(tokenFromSecureRecord({
    serverUrl: 'http://192.168.1.200:3000',
    token: 'abc',
    expiresAt: 1
  }, 2), null);
  const live = tokenFromSecureRecord({
    serverUrl: 'http://192.168.1.200:3000',
    token: jwt({ email: 'a@b.c' })
  }, 2);
  assert.equal(live?.email, 'a@b.c');
  assert.deepEqual(
    reloginPrefill({ serverUrl: 'http://host:3000', userName: 'a@b.c' }),
    { serverUrl: 'http://host:3000', email: 'a@b.c' }
  );
});
