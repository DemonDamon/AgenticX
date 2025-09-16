from fastapi import FastAPI
import random
import time
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

# 配置OpenTelemetry
resource = Resource(attributes={SERVICE_NAME: "flask-app"})
otlp_exporter = OTLPSpanExporter(
    endpoint="localhost:55680",
    insecure=True,
)

provider = TracerProvider(resource=resource)
processor = BatchSpanProcessor(otlp_exporter)
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)
tracer = trace.get_tracer(__name__)

# 创建Flask应用
app = FastAPI()
FastAPIInstrumentor().instrument_app(app)

# 模拟LLM调用
@app.get("/chat")
def chat():
    with tracer.start_as_current_span("llm_request") as span:
        # 模拟LLM请求参数
        prompt = "解释量子计算的基本原理"
        span.set_attribute("llm.prompt", prompt)
        
        # 模拟调用延迟和可能的错误
        time.sleep(random.uniform(0.5, 2))
        success = random.choice([True, False])
        
        if success:
            response = "量子计算利用量子力学现象如叠加和纠缠来执行计算..."
            span.set_attribute("llm.response", response)
            span.set_attribute("llm.tokens_used", random.randint(100, 500))
            return {"status": "success", "response": response}
        else:
            error_msg = "模型调用超时"
            span.set_attribute("error", True)
            span.set_attribute("error.message", error_msg)
            return {"status": "error", "message": error_msg}, 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)