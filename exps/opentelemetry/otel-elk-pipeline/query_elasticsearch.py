from elasticsearch import Elasticsearch
from datetime import datetime, timedelta

# 连接到Elasticsearch
es = Elasticsearch("http://localhost:9200")

# 构建查询 - 获取最近1小时的LLM请求
query = {
    "query": {
        "bool": {
            "must": [
                {"match": {"event_type": "trace"}},
                {"exists": {"field": "llm_prompt"}}
            ],
            "filter": [
                {
                    "range": {
                        "@timestamp": {
                            "gte": "now-1h",
                            "lte": "now"
                        }
                    }
                }
            ]
        }
    },
    "size": 10,
    "sort": [
        {"@timestamp": {"order": "desc"}}
    ]
}

# 执行查询
result = es.search(index="otel-*", body=query)

# 打印结果
print(f"找到 {result['hits']['total']['value']} 条LLM请求记录")
for hit in result['hits']['hits']:
    source = hit['_source']
    print(f"\n时间: {source['@timestamp']}")
    print(f"提示: {source.get('llm_prompt', 'N/A')}")
    print(f"响应: {source.get('llm_response', 'N/A')}")
    print(f"使用token: {source.get('tokens_used', 'N/A')}")
    print(f"错误信息: {source.get('error_message', 'N/A')}")

# 聚合查询 - 计算平均token使用量
aggregation_query = {
    "aggs": {
        "avg_tokens": {
            "avg": {"field": "tokens_used"}
        }
    }
}

agg_result = es.search(index="otel-*", body=aggregation_query)
print(f"\n平均token使用量: {agg_result['aggregations']['avg_tokens']['value']:.2f}")    