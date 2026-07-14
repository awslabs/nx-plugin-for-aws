from sqlalchemy import Column, String
from sqlmodel import Field, SQLModel


class ExampleModel(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(sa_column=Column(String(255), nullable=False))
    description: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
