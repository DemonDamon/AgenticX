#!/bin/bash

# 启动Elasticsearch（假设已安装Docker）
echo "启动Elasticsearch..."
docker run -d --name elasticsearch -p 9200:9200 -p 9300:9300 -e "discovery.type=single-node" elasticsearch:8.8.2

# 启动Kibana
echo "启动Kibana..."
docker run -d --name kibana -p 5601:5601 --link elasticsearch:elasticsearch kibana:8.8.2

# 启动Logstash
echo "启动Logstash..."
docker run -d --name logstash -p 55680:55680 -v $(pwd)/logstash.conf:/usr/share/logstash/pipeline/logstash.conf logstash:8.8.2

# 等待Elasticsearch启动完成
echo "等待Elasticsearch启动..."
until curl -s http://localhost:9200/_cluster/health?wait_for_status=yellow; do
  sleep 1
done

# 安装Python依赖
 echo "安装Python依赖..."
 pip install fastapi uvicorn opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp opentelemetry-instrumentation-fastapi

 # 启动FastAPI应用
 echo "启动FastAPI应用..."
 uvicorn app:app --host 0.0.0.0 --port 5000 &

echo "所有服务已启动!"
echo "- 应用: http://localhost:5000"
echo "- Kibana: http://localhost:5601"
echo "- Elasticsearch: http://localhost:9200"