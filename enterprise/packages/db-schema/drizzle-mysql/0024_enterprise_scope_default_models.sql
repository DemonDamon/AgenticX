-- 部门默认模型。一行一个 dept:<id>。不写 DEFAULT CHARSET/COLLATE。

CREATE TABLE IF NOT EXISTS `enterprise_runtime_scope_default_models` (
  `tenant_id` varchar(26) NOT NULL,
  `assignment_key` varchar(320) NOT NULL,
  `model_id` varchar(256) NOT NULL,
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `enterprise_runtime_scope_default_pk` PRIMARY KEY (`tenant_id`, `assignment_key`)
);
