import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { NapCatAdapter } from '../src/adapters/napcat.js';
import { analyzeOneBotMessage } from '../src/text.js';
import { silentLogger } from '../src/logger.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await wait(20);
  }
  throw new Error('waitFor timeout');
}

test('analyzeOneBotMessage detects an @ of the bot and strips it', () => {
  const result = analyzeOneBotMessage(
    {
      self_id: 10001,
      message: [
        { type: 'at', data: { qq: '10001' } },
        { type: 'text', data: { text: ' 你好呀' } },
      ],
    },
    10001,
  );
  assert.equal(result.mentioned, true);
  assert.equal(result.text, '你好呀');
});

test('analyzeOneBotMessage ignores an @ of another member', () => {
  const result = analyzeOneBotMessage(
    {
      self_id: 10001,
      message: [
        { type: 'at', data: { qq: '20002', name: '小明' } },
        { type: 'text', data: { text: ' 在吗' } },
      ],
    },
    10001,
  );
  assert.equal(result.mentioned, false);
  assert.match(result.text, /@小明/);
});

test('NapCatAdapter replies with an at segment and authenticates the WebSocket', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const { port } = server.address();

  const seenActions = [];
  let authHeader = '';
  let receivedMessage;
  let recordedContext;

  server.on('connection', (socket, request) => {
    authHeader = request.headers.authorization ?? '';
    socket.on('message', (raw) => {
      const payload = JSON.parse(String(raw));
      if (payload.action === 'send_group_msg') {
        seenActions.push(payload);
        socket.send(
          JSON.stringify({
            status: 'ok',
            retcode: 0,
            data: { message_id: 1 },
            echo: payload.echo,
          }),
        );
      }
    });

    socket.send(
      JSON.stringify({
        post_type: 'message',
        message_type: 'group',
        self_id: 10001,
        group_id: 123456,
        user_id: 20002,
        message_id: 9001,
        time: 1,
        sender: { nickname: '测试群友' },
        message: [
          { type: 'at', data: { qq: '10001' } },
          { type: 'text', data: { text: ' 你好' } },
        ],
      }),
    );
  });

  const adapter = new NapCatAdapter({
    wsUrl: `ws://127.0.0.1:${port}`,
    accessToken: 'test-token',
    logger: silentLogger,
    onMessage: async (message) => {
      receivedMessage = message;
      await message.reply('测试回复');
    },
    onGroupMessage: (event) => {
      recordedContext = event;
    },
    reconnectBaseMs: 20,
    reconnectMaxMs: 50,
  });

  try {
    adapter.start();
    const action = await waitFor(() => seenActions[0]);
    assert.equal(authHeader, 'Bearer test-token');
    assert.equal(receivedMessage.platform, 'napcat');
    assert.equal(receivedMessage.groupId, '123456');
    assert.equal(receivedMessage.userId, '20002');
    assert.equal(receivedMessage.text, '你好');
    assert.equal(recordedContext.mentioned, true);
    assert.equal(recordedContext.text, '你好');
    assert.deepEqual(action.params.message[0], {
      type: 'at',
      data: { qq: '20002' },
    });
    assert.match(action.params.message[1].data.text, /测试回复/);
  } finally {
    await adapter.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('NapCatAdapter expands forwarded chat records before calling the bot', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const { port } = server.address();

  let receivedMessage;
  let forwardRequests = 0;

  server.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const payload = JSON.parse(String(raw));

      if (payload.action === 'get_forward_msg') {
        forwardRequests += 1;
        socket.send(
          JSON.stringify({
            status: 'ok',
            retcode: 0,
            data: {
              messages: [
                {
                  sender: { nickname: '小明' },
                  message: [{ type: 'text', data: { text: '周末去露营' } }],
                },
                {
                  sender: { nickname: '小红' },
                  message: [{ type: 'text', data: { text: '我也想去' } }],
                },
              ],
            },
            echo: payload.echo,
          }),
        );
      }

      if (payload.action === 'send_group_msg') {
        socket.send(
          JSON.stringify({
            status: 'ok',
            retcode: 0,
            data: { message_id: 2 },
            echo: payload.echo,
          }),
        );
      }
    });

    socket.send(
      JSON.stringify({
        post_type: 'message',
        message_type: 'group',
        self_id: 10001,
        group_id: 123456,
        user_id: 20002,
        message_id: 9002,
        time: 1,
        sender: { nickname: '测试群友' },
        message: [
          { type: 'at', data: { qq: '10001' } },
          { type: 'text', data: { text: ' 帮我总结一下' } },
          { type: 'forward', data: { id: 'fwd-1' } },
        ],
      }),
    );
  });

  const adapter = new NapCatAdapter({
    wsUrl: `ws://127.0.0.1:${port}`,
    logger: silentLogger,
    onMessage: async (message) => {
      receivedMessage = message;
      await message.reply('收到');
    },
    reconnectBaseMs: 20,
    reconnectMaxMs: 50,
  });

  try {
    adapter.start();
    await waitFor(() => receivedMessage);
    assert.equal(forwardRequests, 1);
    assert.match(receivedMessage.text, /帮我总结一下/);
    assert.match(receivedMessage.text, /小明: 周末去露营/);
    assert.match(receivedMessage.text, /小红: 我也想去/);
  } finally {
    await adapter.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('NapCatAdapter expands a forwarded record referenced by a reply', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const { port } = server.address();

  let receivedMessage;
  let getMessageCalls = 0;
  let forwardCalls = 0;

  server.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const payload = JSON.parse(String(raw));

      if (payload.action === 'get_msg') {
        getMessageCalls += 1;
        socket.send(
          JSON.stringify({
            status: 'ok',
            retcode: 0,
            data: {
              message: [{ type: 'forward', data: { id: 'fwd-reply-1' } }],
            },
            echo: payload.echo,
          }),
        );
      }

      if (payload.action === 'get_forward_msg') {
        forwardCalls += 1;
        socket.send(
          JSON.stringify({
            status: 'ok',
            retcode: 0,
            data: {
              messages: [
                {
                  sender: { nickname: '小明' },
                  message: [{ type: 'text', data: { text: '转发里的内容' } }],
                },
              ],
            },
            echo: payload.echo,
          }),
        );
      }

      if (payload.action === 'send_group_msg') {
        socket.send(
          JSON.stringify({
            status: 'ok',
            retcode: 0,
            data: { message_id: 3 },
            echo: payload.echo,
          }),
        );
      }
    });

    socket.send(
      JSON.stringify({
        post_type: 'message',
        message_type: 'group',
        self_id: 10001,
        group_id: 123456,
        user_id: 20002,
        message_id: 9003,
        time: 1,
        sender: { nickname: '测试群友' },
        message: [
          { type: 'at', data: { qq: '10001' } },
          { type: 'reply', data: { id: 'reply-1' } },
          { type: 'text', data: { text: ' 看这个' } },
        ],
      }),
    );
  });

  const adapter = new NapCatAdapter({
    wsUrl: `ws://127.0.0.1:${port}`,
    logger: silentLogger,
    onMessage: async (message) => {
      receivedMessage = message;
      await message.reply('收到');
    },
    reconnectBaseMs: 20,
    reconnectMaxMs: 50,
  });

  try {
    adapter.start();
    await waitFor(() => receivedMessage);
    assert.equal(getMessageCalls, 1);
    assert.equal(forwardCalls, 1);
    assert.match(receivedMessage.text, /看这个/);
    assert.match(receivedMessage.text, /转发里的内容/);
  } finally {
    await adapter.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('NapCatAdapter uses the most recent forwarded record when replying to a later @', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const { port } = server.address();

  let receivedMessage;
  let forwardCalls = 0;

  server.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const payload = JSON.parse(String(raw));

      if (payload.action === 'get_forward_msg') {
        forwardCalls += 1;
        socket.send(
          JSON.stringify({
            status: 'ok',
            retcode: 0,
            data: {
              messages: [
                {
                  sender: { nickname: '小明' },
                  message: [{ type: 'text', data: { text: '最近转发的露营记录' } }],
                },
              ],
            },
            echo: payload.echo,
          }),
        );
      }

      if (payload.action === 'send_group_msg') {
        socket.send(
          JSON.stringify({
            status: 'ok',
            retcode: 0,
            data: { message_id: 4 },
            echo: payload.echo,
          }),
        );
      }
    });

    // 先单独发一条转发消息，后面再 @ 机器人问“这个聊天记录”。
    socket.send(
      JSON.stringify({
        post_type: 'message',
        message_type: 'group',
        self_id: 10001,
        group_id: 123456,
        user_id: 20002,
        message_id: 9004,
        time: 1,
        sender: { nickname: '测试群友' },
        message: [{ type: 'forward', data: { id: 'fwd-recent-1' } }],
      }),
    );
    socket.send(
      JSON.stringify({
        post_type: 'message',
        message_type: 'group',
        self_id: 10001,
        group_id: 123456,
        user_id: 20002,
        message_id: 9005,
        time: 2,
        sender: { nickname: '测试群友' },
        message: [
          { type: 'at', data: { qq: '10001' } },
          { type: 'text', data: { text: ' 总结一下这个聊天记录' } },
        ],
      }),
    );
  });

  const adapter = new NapCatAdapter({
    wsUrl: `ws://127.0.0.1:${port}`,
    logger: silentLogger,
    onMessage: async (message) => {
      receivedMessage = message;
      await message.reply('收到');
    },
    reconnectBaseMs: 20,
    reconnectMaxMs: 50,
  });

  try {
    adapter.start();
    await waitFor(() => receivedMessage);
    assert.equal(forwardCalls, 1);
    assert.match(receivedMessage.text, /总结一下这个聊天记录/);
    assert.match(receivedMessage.text, /最近转发的露营记录/);
  } finally {
    await adapter.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('NapCatAdapter replies to an allowlisted private QQ', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const { port } = server.address();

  let receivedMessage;
  const actions = [];

  server.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const payload = JSON.parse(String(raw));
      if (payload.action === 'send_private_msg') {
        actions.push(payload);
        socket.send(
          JSON.stringify({
            status: 'ok',
            retcode: 0,
            data: { message_id: 5 },
            echo: payload.echo,
          }),
        );
      }
    });

    socket.send(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        self_id: 10001,
        user_id: 10002,
        message_id: 9101,
        time: 1,
        sender: { nickname: 'test friend' },
        message: [{ type: 'text', data: { text: 'hello' } }],
      }),
    );
  });

  const adapter = new NapCatAdapter({
    wsUrl: `ws://127.0.0.1:${port}`,
    logger: silentLogger,
    privateAllowedUsers: new Set(['10002']),
    onMessage: async (message) => {
      receivedMessage = message;
      await message.reply('private reply');
    },
    reconnectBaseMs: 20,
    reconnectMaxMs: 50,
  });

  try {
    adapter.start();
    const action = await waitFor(() => actions[0]);
    assert.equal(receivedMessage.platform, 'napcat-private');
    assert.equal(receivedMessage.groupId, 'private:10002');
    assert.equal(receivedMessage.text, 'hello');
    assert.equal(action.params.user_id, '10002');
    assert.equal(action.params.message[0].type, 'text');
    assert.match(action.params.message[0].data.text, /private reply/);
  } finally {
    await adapter.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('NapCatAdapter ignores private messages from users outside the allowlist', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const { port } = server.address();
  let receivedMessage = null;

  server.on('connection', (socket) => {
    socket.send(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        self_id: 10001,
        user_id: 999999,
        message_id: 9102,
        time: 1,
        sender: { nickname: 'stranger' },
        message: [{ type: 'text', data: { text: 'hello' } }],
      }),
    );
  });

  const adapter = new NapCatAdapter({
    wsUrl: `ws://127.0.0.1:${port}`,
    logger: silentLogger,
    privateAllowedUsers: new Set(['10002']),
    onMessage: async (message) => {
      receivedMessage = message;
    },
    reconnectBaseMs: 20,
    reconnectMaxMs: 50,
  });

  try {
    adapter.start();
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(receivedMessage, null);
  } finally {
    await adapter.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});
