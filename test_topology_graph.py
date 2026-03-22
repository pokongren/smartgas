import sys
import os

sys.path.append(os.path.abspath('backend'))

from sqlmodel import create_engine, Session, select
from app.models import JunctionGroup
from app.services.topology import TopologyService

engine = create_engine('sqlite:///backend/data/smartgas.db')

with Session(engine) as session:
    print('JunctionGroup in DB:', len(session.exec(select(JunctionGroup)).all()))
    
    svc = TopologyService(session)
    graph = svc._build_computation_graph(directed=True)
    
    junc_nodes = [n for k, n in graph._nodes.items() if k.startswith('JUNC_')]
    print('JUNC nodes in graph:', len(junc_nodes))
    if junc_nodes:
        print('Sample:', junc_nodes[0].properties)
