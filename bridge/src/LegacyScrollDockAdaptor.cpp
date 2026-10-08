#include "LegacyScrollDockAdaptor.h"

LegacyScrollDockAdaptor::LegacyScrollDockAdaptor(CCNiriBridge *bridge)
    : QDBusAbstractAdaptor(bridge), m_bridge(bridge)
{
    setAutoRelaySignals(true);
}
