-- 删掉 enterprise_feature_assignments。
--
-- 联网搜索和深度研究已经是能力包的成员（`feature:web_search` / `feature:deep_research`），
-- 判定走 web-portal 的 isPlatformFeatureAllowedForUser，只认包。这张表从那时起就没有
-- 任何运行时再查了 —— 留着它的唯一效果，是让下一个人以为往里写点什么能改变谁能用。
--
-- ⚠️ 升级前先看一眼这张表还有没有行：
--
--     SELECT feature, assignment_key FROM enterprise_feature_assignments;
--
-- 有行，说明这个部署当年用它收窄过范围（例如只给销售部开联网搜索）。那份收窄**现在
-- 已经不生效了**，不是被这条迁移改掉的；但删表之后就再也查不到当年配的是谁。要保留，
-- 就先在管理后台按同样的范围建一个能力包，把对应的 feature 放进去，再跑这条迁移。

DROP TABLE IF EXISTS "enterprise_feature_assignments";
