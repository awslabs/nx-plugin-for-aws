from pydantic import BaseModel

from .init import app, lambda_handler, tracer

handler = lambda_handler

class EchoOutput(BaseModel):
    message: str

@app.get("/echo")
@tracer.capture_method
def echo(message: str) -> EchoOutput:
    return EchoOutput(message=f"{message}")
