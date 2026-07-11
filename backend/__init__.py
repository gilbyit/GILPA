"""Package backend di GILPA.

Importato come 'src' nel container (uvicorn src.main:app) e come 'backend' nei
test. Gli import interni sono relativi (from .db import ...), quindi funzionano in
entrambi i casi purché questo file e routers/__init__.py siano presenti.
"""