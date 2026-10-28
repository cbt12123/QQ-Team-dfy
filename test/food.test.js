import test from "node:test";
import assert from "node:assert/strict";
import {
  FoodService,
  parseCoordinates,
  normalizeRestaurants,
} from "../src/food/food-service.js";
import { ChatEngine } from "../src/chat/engine.js";
import { LlmClient } from "../src/chat/llm.js";

const center = [121.261, 31.12];
const place = {
  name: "泗泾地铁站",
  location: center.join(","),
  adname: "松江区",
  address: "地铁9号线",
};
const restaurants = [
  {
    id: "r1",
    name: "测试面馆甲",
    typecode: "050100",
    location: "121.262,31.12",
    address: "测试路1号",
    business: { rating: "4.8", cost: "25" },
  },
  {
    id: "r2",
    name: "测试面馆乙",
    typecode: "050100",
    location: "121.263,31.12",
    business: { rating: "4.6", cost: "18" },
  },
  {
    id: "r3",
    name: "测试面馆丙",
    typecode: "050100",
    location: "121.264,31.12",
    business: { rating: [], cost: [] },
  },
  {
    id: "r4",
    name: "超预算测试餐厅",
    typecode: "050100",
    location: "121.265,31.12",
    business: { rating: "4.9", cost: "88" },
  },
];
const requestText = "上海泗泾地铁站附近，30元以内想吃面";
const basePlan = {
  intent: true,
  location: "泗泾地铁站",
  city: "上海",
  keywords: "面",
  budget: 30,
  radiusMeters: 3000,
};

function fixture({
  plan = basePlan,
  pois = restaurants,
  places = [place],
  apiKey = "test-secret",
  ...options
} = {}) {
  const calls = [];
  const parses = [];
  const warnings = [];
  let now = 1000;
  const service = new FoodService({
    ...options,
    apiKey,
    now: () => now,
    logger: { warn: (...args) => warnings.push(args) },
    llm: {
      enabled: true,
      chat: async (o) => {
        parses.push(o);
        return typeof plan === "function" ? plan(o) : JSON.stringify(plan);
      },
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), init });
      return {
        ok: true,
        json: async () => ({
          status: "1",
          pois: url.includes("/text?") ? places : pois,
        }),
      };
    },
  });
  const query = (text = requestText, sessionKey = "napcat:g1:u1") =>
    service.handle({ text, sessionKey });
  return {
    service,
    calls,
    parses,
    warnings,
    query,
    advance: (n) => {
      now += n;
    },
  };
}

test("coordinates validate order/range and support Chinese separators", () => {
  assert.deepEqual(parseCoordinates("121.261，31.12"), center);
  for (const bad of ["181,31", "121,91", "xx", "121,31junk", []])
    assert.equal(parseCoordinates(bad), null);
});

test("food lookup uses official endpoints and real response fields only", async () => {
  const f = fixture();
  const result = await f.query();
  assert.match(result.text, /测试面馆甲/);
  assert.doesNotMatch(result.text, /超预算测试餐厅/);
  assert.match(result.text, /地图 4.8 分/);
  assert.match(result.text, /25 元/);
  assert.match(result.text, /人均待确认/);
  assert.match(result.text, /直线约/);
  assert.match(result.text, /不是已确认可配送/);
  assert.doesNotMatch(result.text, /https?:\/\//);
  assert.doesNotMatch(result.text, /test-secret/);
  assert.equal(f.calls[0].url.pathname, "/v5/place/text");
  assert.equal(f.calls[0].url.searchParams.get("region"), "上海");
  assert.equal(f.calls[0].url.searchParams.get("city_limit"), "true");
  assert.equal(f.calls[1].url.pathname, "/v5/place/around");
  assert.equal(f.calls[1].url.searchParams.get("types"), null);
  assert.equal(f.calls[1].url.searchParams.get("show_fields"), "business");
});

test("invalid, duplicate, non-food, out-of-radius and over-budget POIs are excluded", () => {
  const pois = [
    ...restaurants,
    restaurants[0],
    { ...restaurants[0], id: "badloc", location: "oops" },
    { ...restaurants[0], id: "far", location: "122,32" },
    { ...restaurants[0], id: "bank", typecode: "160100" },
  ];
  const results = normalizeRestaurants(pois, center, 3000, 30);
  assert.deepEqual(
    results.map((r) => r.id),
    ["r1", "r2", "r3"],
  );
});

test("cheap and nearby refinements use reference price and distance", () => {
  assert.equal(
    normalizeRestaurants(restaurants, center, 3000, null, "cost")[0].id,
    "r2",
  );
  assert.equal(
    normalizeRestaurants(restaurants, center, 3000, null, "distance")[0].id,
    "r1",
  );
});

test("missing key and disabled mode make no outbound requests", async () => {
  const missing = fixture({ apiKey: "" });
  assert.match((await missing.query()).text, /Web 服务 Key/);
  assert.equal(missing.calls.length, 0);
  assert.equal(missing.parses.length, 0);
  const disabled = fixture({ enabled: false });
  assert.equal(await disabled.query(), null);
});

test("normal chatter and technical discussion do not trigger a map lookup", async () => {
  const f = fixture();
  for (const text of ["今天真开心", "帮我研究外卖推荐算法", "外卖接口怎么实现"])
    assert.equal(await f.query(text), null);
  assert.equal(f.parses.length, 0);
});

test("actual dialogue: a plain nearby restaurant request overrides the previous delivery mode", async () => {
  const f = fixture({ plan: { ...basePlan, mode: "delivery" } });
  await f.query("再给我推荐仨外卖，上海泗泾地铁站附近");
  const result = await f.query("上海泗泾地铁站附近餐厅");
  assert.match(result.text, /测试面馆甲/);
  assert.doesNotMatch(result.text, /还不能核实哪些店能送到/);
  assert.equal(f.service.isDeliverySession("napcat:g1:u1"), false);
});

test("actual late-night intent excludes barbecue, tea and banquets and broadens to filling foods", async () => {
  const extras = [
    {
      ...restaurants[0],
      id: "bbq",
      name: "烧烤摊",
      type: "烧烤",
      business: { rating: "4.9", cost: "18" },
    },
    {
      ...restaurants[0],
      id: "tea",
      name: "茶艺馆",
      type: "茶艺馆",
      business: { rating: "4.9", cost: "68" },
    },
    { ...restaurants[0], id: "banquet", name: "宴会厅", type: "宴会餐厅" },
    { ...restaurants[0], id: "hotpot", name: "重庆火锅", type: "火锅店" },
  ];
  const f = fixture({
    plan: { ...basePlan, keywords: "", budget: null },
    pois: [...extras, ...restaurants],
  });
  const result = await f.query(
    "上海泗泾地铁站附近，我现在饿了，不想吃烧烤，你给我推荐下吃什么宵夜",
  );
  assert.match(result.text, /测试面馆甲/);
  assert.doesNotMatch(result.text, /烧烤摊|茶艺馆|宴会厅|重庆火锅/);
  const keywords = f.calls
    .filter((c) => c.url.pathname.endsWith("/around"))
    .map((c) => c.url.searchParams.get("keywords"));
  assert.deepEqual(keywords.sort(), ["粥", "面馆", "馄饨"].sort());
  assert.match(result.text, /是否还在营业需确认/);
});

test("meal filters preserve explicit drink and hotpot preferences rather than excluding them globally", () => {
  const poi = { ...restaurants[0], name: "测试茶艺馆" };
  assert.equal(
    normalizeRestaurants([poi], center, 3000, null, "rating", {
      mealKind: "meal",
    }).length,
    0,
  );
  assert.equal(
    normalizeRestaurants([poi], center, 3000, null, "rating", {
      mealKind: "drink",
      keywords: "茶",
    }).length,
    1,
  );
  const hotpot = { ...poi, name: "测试火锅店" };
  assert.equal(
    normalizeRestaurants([hotpot], center, 3000, null, "rating", {
      mealKind: "snack",
      keywords: "火锅",
    }).length,
    1,
  );
});

test("delivery requests provide takeaway-style candidates with a clear unverified-delivery label", async () => {
  const f = fixture();
  for (const text of [
    "上海泗泾地铁站附近帮我找找外卖",
    "便宜点",
    "这几家其实不是外卖",
  ]) {
    const result = await f.query(text);
    assert.match(result.text, /测试面馆/);
    assert.match(result.text, /配送待确认/);
    assert.doesNotMatch(
      result.text,
      /还不能核实哪些店能送到|发一张|https?:\/\//,
    );
  }
  assert.ok(f.calls.length >= 4);
  assert.equal(f.service.isDeliverySession("napcat:g1:u1"), true);
  const nearby = await f.query("附近餐厅也行");
  assert.match(nearby.text, /测试面馆甲/);
  assert.equal(f.service.isDeliverySession("napcat:g1:u1"), false);
});

test("delivery extraction errors and a missing key give actionable errors without fabricated shops", async () => {
  const rejected = fixture({ plan: { intent: false } });
  assert.equal(await rejected.query("上海泗泾地铁站附近推荐外卖"), null);
  for (const [options, expected] of [
    [{ plan: () => "bad json" }, /准确读出位置/],
    [{ apiKey: "" }, /Web 服务 Key/],
  ]) {
    const f = fixture(options);
    const result = await f.query("上海泗泾地铁站附近推荐外卖");
    assert.match(result.text, expected);
    assert.equal(f.calls.length, 0);
  }
});

test("takeaway candidates exclude high-rated tea, dessert, banquet and formal dining venues", async () => {
  const unsuitable = [
    {
      ...restaurants[0],
      id: "banquet",
      name: "高分宴会厅",
      type: "餐饮服务;中餐厅",
      business: { rating: "4.9", cost: "18" },
    },
    {
      ...restaurants[0],
      id: "tea",
      name: "高分茶艺馆",
      type: "茶艺馆",
      business: { rating: "4.9", cost: "18" },
    },
    {
      ...restaurants[0],
      id: "cake",
      name: "千层蛋糕",
      type: "甜品店",
      business: { rating: "4.9", cost: "18" },
    },
  ];
  const f = fixture({ pois: [...unsuitable, ...restaurants] });
  const result = await f.query("上海泗泾地铁站附近帮我找找外卖");
  assert.match(result.text, /测试面馆甲/);
  assert.doesNotMatch(result.text, /高分宴会厅|高分茶艺馆|千层蛋糕/);
});

test("cheap takeaway refinement excludes clearly low-rated candidates", () => {
  const pois = [
    ...restaurants,
    {
      ...restaurants[0],
      id: "low",
      name: "低分便宜面馆",
      business: { cost: "5", rating: "2.3" },
    },
  ];
  const result = normalizeRestaurants(pois, center, 3000, null, "cost", {
    mode: "delivery",
    keywords: "面",
  });
  assert.equal(
    result.some((r) => r.id === "low"),
    false,
  );
  assert.equal(result[0].id, "r2");
});

test("negative delivery wording with an explicit dine-in request still finds nearby restaurants", async () => {
  const f = fixture();
  const result = await f.query(
    "上海泗泾地铁站，不要外卖，找附近堂食餐厅，30元以内想吃面",
  );
  assert.match(result.text, /测试面馆甲/);
  assert.doesNotMatch(result.text, /还不能核实哪些店能送到/);
});

test("restaurant replies are compact lists with no links, long addresses or unknown rating placeholders", async () => {
  const f = fixture();
  const { text } = await f.query();
  assert.doesNotMatch(text, /https?:\/\/|测试路1号|暂无|来源：/);
  assert.match(
    text,
    /1\. 测试面馆甲\n参考人均约 25 元 · 直线约 \d+米 · 地图 4.8 分/,
  );
  assert.match(text, /3\. 测试面馆丙\n人均待确认 · 直线约 \d+米/);
  assert.ok(text.length < 400);
});

test("food screenshots bypass map recommendations and produce a link-free grounded reply", async () => {
  const f = fixture();
  await f.query("上海泗泾地铁站附近推荐外卖");
  const mapCallsBeforeScreenshot = f.calls.length;
  const calls = [];
  const engine = new ChatEngine(
    {
      maxHistoryTurns: 4,
      historyTtlMs: 60_000,
      replyMaxChars: 1200,
      replyMaxParts: 4,
      vision: { model: "vision-fixture" },
    },
    {
      food: f.service,
      llm: {
        enabled: true,
        chat: async (o) => {
          calls.push(o);
          return "截图里可以看这家：测试面馆，截图标价20元。 [详情](https://example.com/shop)";
        },
      },
      vision: {
        enabled: true,
        prepare: async () => ["data:image/png;base64,fixture"],
      },
    },
  );
  const result = await engine.reply({
    platform: "napcat",
    groupId: "g1",
    userId: "u1",
    text: "[图片]",
    images: ["https://example.com/screenshot.png"],
  });
  assert.match(result.text, /截图里/);
  assert.doesNotMatch(result.text, /https?:\/\//);
  assert.equal(result.forceText, true);
  assert.equal(calls[0].model, "vision-fixture");
  assert.match(calls[0].userText, /只依据截图清晰可见/);
  assert.equal(f.calls.length, mapCallsBeforeScreenshot);
});

test("unreadable food screenshots do not fall through to fabricated general recommendations", async () => {
  const f = fixture();
  const engine = new ChatEngine(
    {},
    {
      food: f.service,
      llm: {
        enabled: true,
        chat: async () => {
          throw new Error("must not call");
        },
      },
      vision: { enabled: false },
    },
  );
  const result = await engine.reply({
    platform: "napcat",
    groupId: "g1",
    userId: "u1",
    text: "帮我从截图推荐外卖",
    images: ["https://example.com/screenshot.png"],
  });
  assert.equal(result.command, "food-image-error");
  assert.match(result.text, /没读成功/);
});

test("missing city/landmark is clarified instead of using profile or group location", async () => {
  const f = fixture({ plan: { ...basePlan, location: "人民广场", city: "" } });
  assert.match((await f.query("人民广场附近有什么餐厅推荐")).text, /哪个城市/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.service.shouldHandle("上海", "napcat:g1:u1"), true);
});

test("hallucinated locations and cities are rejected before map requests", async () => {
  const f = fixture();
  assert.match((await f.query("推荐一下附近的美食")).text, /哪个城市/);
  assert.equal(f.calls.length, 0);
});

test("same-name distant landmarks ask for clarification instead of choosing silently", async () => {
  const f = fixture({ places: [place, { ...place, location: "121.5,31.3" }] });
  assert.match((await f.query()).text, /相距较远/);
  assert.equal(f.calls.length, 1);
});

test("users can select an ambiguous landmark by number and continue from that location", async () => {
  const f = fixture({
    places: [
      place,
      { ...place, name: "泗泾地铁站二号位置", location: "121.5,31.3" },
    ],
  });
  await f.query();
  assert.equal(f.service.shouldHandle("第一个", "napcat:g1:u1"), true);
  const result = await f.query("第一个");
  assert.match(result.text, /测试面馆甲/);
  assert.equal(
    f.parses.length,
    1,
    "number selection should not need a second model extraction",
  );
  assert.equal(f.calls.at(-1).url.pathname, "/v5/place/around");
});

test("refining an existing location reuses its coordinates and enforces cheaper sorting", async () => {
  const f = fixture();
  await f.query();
  await f.query("便宜点");
  assert.equal(
    f.calls.filter((r) => r.url.pathname.endsWith("/text")).length,
    1,
  );
  const result = await f.query("便宜点");
  assert.ok(
    result.text.indexOf("测试面馆乙") < result.text.indexOf("测试面馆甲"),
  );
});

test("empty and malformed map results do not fabricate recommendations", async () => {
  assert.match((await fixture({ pois: [] }).query()).text, /没查到/);
  assert.match((await fixture({ places: [] }).query()).text, /没有查到/);
});

test("coordinates can be used without city and are bounded to six decimal places for Amap", async () => {
  const f = fixture({
    plan: { ...basePlan, location: "121.261,31.12", city: "" },
  });
  assert.match((await f.query("121.261,31.12附近美食推荐")).text, /测试面馆/);
  assert.equal(f.calls.length, 1);
  assert.equal(
    f.calls[0].url.searchParams.get("location"),
    "121.261000,31.120000",
  );
});

test("query context stays within the same group/user and expires or resets", async () => {
  const f = fixture();
  await f.query();
  assert.equal(f.service.shouldHandle("便宜点", "napcat:g1:u1"), true);
  assert.equal(f.service.shouldHandle("便宜点", "napcat:g2:u1"), false);
  assert.equal(f.service.shouldHandle("便宜点", "napcat:g1:u2"), false);
  f.service.clear("napcat:g1:u1");
  assert.equal(f.service.shouldHandle("便宜点", "napcat:g1:u1"), false);
  await f.query();
  f.advance(600_001);
  assert.equal(f.service.shouldHandle("便宜点", "napcat:g1:u1"), false);
});

test("refinements carry previous conditions and can request a new batch", async () => {
  const f = fixture({
    maxResults: 1,
    plan: (o) => {
      const { message, previous } = JSON.parse(o.userText);
      return JSON.stringify({
        ...basePlan,
        ...(previous ?? {}),
        changeBatch: message === "换一批",
      });
    },
  });
  assert.match((await f.query()).text, /测试面馆甲/);
  const second = await f.query("换一批");
  assert.match(second.text, /测试面馆乙/);
  assert.doesNotMatch(second.text, /测试面馆甲/);
  assert.equal(JSON.parse(f.parses[1].userText).previous.city, "上海");
});

test("moving to a new place cannot silently inherit the previous city", async () => {
  let count = 0;
  const f = fixture({
    plan: () =>
      JSON.stringify(
        ++count === 1 ? basePlan : { ...basePlan, location: "人民广场" },
      ),
  });
  await f.query();
  assert.match(
    (await f.query("我换到人民广场附近了，推荐餐厅")).text,
    /哪个城市/,
  );
  assert.equal(f.calls.length, 2);
});

test("parser failures and non-food intent are handled safely", async () => {
  assert.match(
    (await fixture({ plan: () => "not json" }).query()).text,
    /准确读出位置/,
  );
  assert.equal(await fixture({ plan: { intent: false } }).query(), null);
});

test("API permission and transport errors never expose credentials or provider payloads", async () => {
  for (const failure of ["permission", "network"]) {
    const f = fixture();
    f.service.fetchImpl = async () => {
      if (failure === "network")
        throw new Error("url?key=test-secret&address=private-address");
      return {
        ok: true,
        json: async () => ({
          status: "0",
          infocode: "10001",
          info: "test-secret",
        }),
      };
    };
    const result = await f.query();
    assert.match(result.text, /查询暂时失败/);
    assert.doesNotMatch(
      result.text + JSON.stringify(f.warnings),
      /test-secret|private-address/,
    );
  }
});

test("food requests use the same dedicated path in direct and unmentioned conversations", async () => {
  const f = fixture();
  const engine = new ChatEngine(
    {
      maxHistoryTurns: 4,
      historyTtlMs: 60_000,
      replyMaxChars: 1200,
      replyMaxParts: 4,
    },
    {
      food: f.service,
      llm: {
        enabled: true,
        chat: () => {
          throw new Error("not general chat");
        },
      },
    },
  );
  const result = await engine.reply({
    platform: "napcat",
    groupId: "g1",
    userId: "u1",
    text: requestText,
  });
  assert.equal(result.command, "food");
  assert.equal(result.forceText, true);
  assert.doesNotMatch(result.text, /https?:\/\//);
  const unsolicited = await engine.proactiveReply({
    groupId: "g1",
    userId: "u1",
    triggerText: requestText,
  });
  assert.match(unsolicited, /测试面馆甲/);
  assert.ok(
    unsolicited.length > 160,
    "restaurant lists must not be truncated to the short-chat limit",
  );
  await engine.reply({
    platform: "napcat",
    groupId: "g1",
    userId: "u1",
    text: "/reset",
  });
  assert.equal(f.service.shouldHandle("便宜点", "napcat:g1:u1"), false);
});

test("structured extraction can override persona, temperature and output budget without changing normal chat", async () => {
  const bodies = [];
  const client = new LlmClient(
    {
      baseUrl: "https://example.com/v1",
      apiKey: "test",
      model: "test",
      systemPrompt: "persona",
      temperature: 0.85,
      maxTokens: 500,
      timeoutMs: 1000,
    },
    {
      fetchImpl: async (_, options) => {
        bodies.push(JSON.parse(options.body));
        return {
          ok: true,
          text: async () =>
            JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
        };
      },
    },
  );
  await client.chat({
    userText: "extract",
    systemPrompt: "parser",
    temperature: 0,
    maxTokens: 400,
  });
  await client.chat({ userText: "hello" });
  assert.equal(bodies[0].messages[0].content, "parser");
  assert.equal(bodies[0].temperature, 0);
  assert.equal(bodies[0].max_tokens, 400);
  assert.equal(bodies[1].messages[0].content, "persona");
  assert.equal(bodies[1].temperature, 0.85);
});

test("loose map keyword matches do not let barbecue aliases or banquet dishes through as supper", () => {
  const unsuitable = [
    { ...restaurants[0], id: "grill", name: "清真刚刚烤肉", type: "中餐厅" },
    {
      ...restaurants[0],
      id: "banquet",
      name: "千年陕菜宴",
      type: "中餐厅",
      business: { rating: "4.9", tag: "牛肉面,大盘鸡" },
    },
  ];
  const filtered = normalizeRestaurants(
    [...unsuitable, restaurants[0]],
    center,
    3000,
    null,
    "rating",
    { mealKind: "snack", keywords: "", excludeKeywords: ["烧烤"] },
  );
  assert.deepEqual(
    filtered.map((r) => r.id),
    ["r1"],
  );
});
