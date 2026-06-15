import os

import boto3

rds = boto3.client('rds')
INSTANCE_ID = os.environ['DB_INSTANCE_ID']


def handler(event, _context):
    action = event.get('action')
    instance = rds.describe_db_instances(DBInstanceIdentifier=INSTANCE_ID)['DBInstances'][0]
    status = instance['DBInstanceStatus']

    if action == 'stop':
        if status in ('stopped', 'stopping'):
            return {'action': action, 'status': status, 'skipped': True}
        rds.stop_db_instance(DBInstanceIdentifier=INSTANCE_ID)
        return {'action': action, 'status': 'stopping'}

    if action == 'start':
        if status in ('available', 'starting'):
            return {'action': action, 'status': status, 'skipped': True}
        rds.start_db_instance(DBInstanceIdentifier=INSTANCE_ID)
        return {'action': action, 'status': 'starting'}

    raise ValueError(f'Unknown action: {action}')
