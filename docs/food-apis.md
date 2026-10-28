# 餐饮与外卖接口核验

核验日期：2026-10-28。

## 高德地图（已接入）

- 官方文档：https://lbs.amap.com/api/webservice/guide/api/newpoisearch
- 文本地标解析：GET https://restapi.amap.com/v5/place/text ，使用 keywords、region、city_limit，避免默认全国定位。
- 周边餐饮：GET https://restapi.amap.com/v5/place/around ，使用 location（经度在前）、radius、show_fields=business、sortrule=distance、page_size=25。
- 无关键词时限制 types=050000；有食物关键词时按关键词查询，并在本地校验餐饮类型、食物类别及排除项，避免宽泛相关结果挤占候选。宵夜未指定食物时查询粥、面馆、馄饨，并过滤茶艺馆、宴会餐厅和用户明确排除的烧烤等。
- 商业字段 business.rating、business.cost 可能缺失，不能当作实时外卖评分或价格。距离由返回坐标计算，表示相对查询中心的直线距离。
- 回复只提供简短的餐厅列表，不生成或发送地图链接及长地址。
- 需要 Web 服务 Key 和对应接口权限、可用配额；不保证所有账号默认有权限或免费。服务不会自动注册账户或购买配额。

## 美团（已调研，未接入）

- 官方能力页：https://developer.meituan.com/isv/waimai?location=foodManagement
- 门店配送范围：https://developer.meituan.com/docs/api/waimai-ng-shipping-list
- 统一授权：https://developer.meituan.com/isv/announcement/detail?dockey=anno-all&id=announcement-7197
- 已找到能力主要面向授权商户的门店、商品、订单和配送管理，不能推导出可供任意消费者查询任意地址全部店铺的通用权限。企业用餐另有商务接入渠道，不能假定本项目已有权限。

## 饿了么（已调研，未接入）

- 官方入驻介绍：https://open.shop.ele.me/static/files/join-eleme-openapi.pdf
- 官方说明包含开发者入驻、认证、创建应用、开发审核及商家授权流程。
- 不能把授权商户接口当成无需授权的消费者周边外卖搜索接口。

## 当前功能边界

按用户确认的方式：外卖请求直接推荐适合点外卖的快餐、小吃、便当、面饭类地图候选，明确标注配送待确认；不再固定拒绝或强制要求截图。不会声称已核验平台营业、配送范围、菜单或到手价。仍支持截图辅助挑选。

## 新补充核验的真实平台接口（尚未接入）

- 美团企业版外卖： https://h5.dianping.com/app/bep-docs/sky-doc/canyinopenapi/waimai_api.html ，`/waimai/v1/poi/list` 可以按坐标查询商家，返回营业状态、配送费、起送价、评分及预计配送时间；需要平台分配 token、sign、aesKey。高德 Key 不能替代这些凭证。
- 美团联盟商品查询： https://page.meituan.net/html/1701831807616_1db0df/index.html ，外卖商品券可带可配送门店信息，但它是推广券供给，不等同完整消费者外卖列表，且需要联盟 AppKey 和签名凭证。
- 之前仅调查商户接口不足以概括所有外卖开放能力。以上两类渠道已补充核验；当前用户选择先使用标注待确认的地图候选，没有接入或购买上述平台权限。
