import { normalizeServerUrl, parseInviteTarget } from '@gteam/shared';

describe('邀请链接解析', () => {
  it('保留邀请链接里的 http 局域网地址', () => {
    const link = `gteam://join?server=${encodeURIComponent('http://192.168.1.200:3000')}&invite=abc123`;
    expect(parseInviteTarget(link, '')).toEqual({
      serverUrl: 'http://192.168.1.200:3000',
      inviteCode: 'abc123'
    });
  });

  it('没有 server 参数时按 http 补全主机和端口', () => {
    expect(parseInviteTarget('gteam://192.168.1.200:3000?invite=abc', '')).toEqual({
      serverUrl: 'http://192.168.1.200:3000',
      inviteCode: 'abc'
    });
  });

  it('普通地址和单独的邀请码可以分开填写', () => {
    expect(parseInviteTarget('192.168.1.200:3000/', 'code')).toEqual({
      serverUrl: 'http://192.168.1.200:3000',
      inviteCode: 'code'
    });
  });

  it('已经带协议的地址不会被改成 https', () => {
    expect(normalizeServerUrl('https://team.example.com/')).toBe('https://team.example.com');
  });
});
