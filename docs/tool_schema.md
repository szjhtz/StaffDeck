# Tool Schema

First version tools are HTTP APIs.

```json
{
  "name": "order.query",
  "display_name": "订单查询",
  "description": "根据订单号查询订单状态。",
  "method": "POST",
  "url": "http://localhost:8000/api/mock/order/query",
  "headers": {},
  "auth": {},
  "input_schema": {
    "type": "object",
    "properties": {
      "order_id": { "type": "string" }
    },
    "required": ["order_id"]
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "order_id": { "type": "string" },
      "status": { "type": "string" },
      "signed_days": { "type": "integer" },
      "refundable": { "type": "boolean" }
    }
  },
  "allowed_skills": ["after_sales_refund"],
  "enabled": true
}
```

Unpersisted tool suggestions can be probed before creation:

```json
{
  "tenant_id": "tenant_demo",
  "name": "member.benefit_reconcile",
  "method": "POST",
  "url": "http://localhost:8000/api/mock/member/benefit-reconcile",
  "headers": {},
  "auth": {},
  "input_schema": {},
  "output_schema": {},
  "sample_arguments": {
    "user_id": "user_demo",
    "order_id": "A12345"
  }
}
```
