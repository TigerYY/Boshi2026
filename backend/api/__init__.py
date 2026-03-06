from .news import router as news_router
from .events import router as events_router, units_router, zones_router
from .analysis import router as analysis_router
from .control import router as control_router
from .live import router as live_router
from .youtube import router as youtube_router
from .chat import router as chat_router

__all__ = ["news_router", "events_router", "units_router", "zones_router",
           "analysis_router", "control_router", "live_router", "youtube_router", "chat_router"]
