"""Notion-backed content records for the contentOS pipeline."""

import os
import uuid

import requests

NOTION_API = 'https://api.notion.com/v1'
NOTION_VERSION = '2025-09-03'
DEFAULT_DATABASE_ID = '3c129c35-73ff-8043-b840-c97d0856bd3f'

STAGES = [
    'Idea Generation',
    'Idea Selection',
    'Planning + Scripting',
    'Filming',
    'Editing',
    'Review',
    'Scheduling / Release',
    'Comment Replying + Engagement',
    'Iteration + Learning Loop',
    'Shipped',
    'Denied',
]

STAGE_TO_ID = {
    'Idea Generation': 'idea-generation',
    'Idea Selection': 'idea-selection',
    'Planning + Scripting': 'planning',
    'Filming': 'filming',
    'Editing': 'editing',
    'Review': 'review',
    'Scheduling / Release': 'scheduling',
    'Comment Replying + Engagement': 'engagement',
    'Iteration + Learning Loop': 'iteration',
    'Shipped': 'shipped',
    'Denied': 'denied',
}
ID_TO_STAGE = {value: key for key, value in STAGE_TO_ID.items()}

PROPERTY_DEFINITIONS = {
    'Stage': {
        'select': {
            'options': [
                {'name': name, 'color': color}
                for name, color in zip(
                    STAGES,
                    [
                        'gray', 'yellow', 'blue', 'orange', 'purple', 'pink',
                        'brown', 'red', 'green', 'green', 'gray',
                    ],
                )
            ]
        }
    },
    'Owner': {'people': {}},
    'Due Date': {'date': {}},
    'Filming Date': {'date': {}},
    'Impact': {'number': {'format': 'number'}},
    'Effort': {'number': {'format': 'number'}},
    'Draft': {'rich_text': {}},
    'Hook': {'rich_text': {}},
    'Shot List': {'rich_text': {}},
    'Review Notes': {'rich_text': {}},
    'Learning': {'rich_text': {}},
    'Publish Date': {'date': {}},
    'Posted At': {'date': {}},
    'Live URL': {'url': {}},
    'contentOS ID': {'rich_text': {}},
}


class NotionError(RuntimeError):
    def __init__(self, message, status_code=500):
        super().__init__(message)
        self.status_code = status_code


def _plain_text(parts):
    return ''.join(part.get('plain_text') or part.get('text', {}).get('content', '') for part in (parts or []))


def _rich_text(value):
    if not value:
        return []
    # Notion limits each rich-text element to 2,000 characters.
    return [
        {'type': 'text', 'text': {'content': value[index:index + 2000]}}
        for index in range(0, len(value), 2000)
    ]


def _as_date(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:10]


class NotionContentStore:
    def __init__(self, token=None, database_id=None):
        self.token = token or os.environ.get('NOTION_TOKEN')
        self.database_id = (database_id or os.environ.get('NOTION_DATABASE_ID') or DEFAULT_DATABASE_ID).replace('-', '')
        self._data_source_id = None
        self._schema = None
        self._title_property = 'Name'
        self._views_result = None

    @property
    def configured(self):
        return bool(self.token and self.database_id)

    @property
    def headers(self):
        return {
            'Authorization': f'Bearer {self.token}',
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
        }

    def _request(self, method, path, **kwargs):
        if not self.configured:
            raise NotionError('NOTION_TOKEN is not configured', 503)
        try:
            response = requests.request(
                method,
                f'{NOTION_API}{path}',
                headers=self.headers,
                timeout=20,
                **kwargs,
            )
        except requests.RequestException as exc:
            raise NotionError(f'Notion request failed: {exc}', 502) from exc
        if response.status_code >= 300:
            try:
                detail = response.json().get('message') or response.text
            except ValueError:
                detail = response.text
            raise NotionError(f'Notion returned {response.status_code}: {detail}', response.status_code)
        try:
            return response.json()
        except ValueError as exc:
            raise NotionError('Notion returned invalid JSON', 502) from exc

    def resolve_data_source(self, refresh=False):
        if self._data_source_id and not refresh:
            return self._data_source_id
        database = self._request('GET', f'/databases/{self.database_id}')
        sources = database.get('data_sources') or []
        if not sources:
            raise NotionError('The Notion database has no data source', 422)
        self._data_source_id = sources[0]['id']
        return self._data_source_id

    def get_schema(self, refresh=False):
        if self._schema is not None and not refresh:
            return self._schema
        source_id = self.resolve_data_source(refresh=refresh)
        source = self._request('GET', f'/data_sources/{source_id}')
        self._schema = source.get('properties') or {}
        title = next((name for name, prop in self._schema.items() if prop.get('type') == 'title'), None)
        if not title:
            raise NotionError('The Notion data source has no title property', 422)
        self._title_property = title
        return self._schema

    def _property_name(self, logical):
        schema = self._schema or {}
        if logical in schema:
            return logical
        target = logical.lower()
        for name in schema:
            if name.lower() == target:
                return name
        return logical

    def _property_id(self, logical):
        schema = self.get_schema()
        actual = self._property_name(logical)
        return (schema.get(actual) or {}).get('id')

    def _stage_type(self):
        schema = self.get_schema()
        actual = self._property_name('Stage')
        prop_type = (schema.get(actual) or {}).get('type')
        return prop_type if prop_type in ('select', 'status') else 'select'

    def _stage_filter(self, operator, value):
        return {'property': self._property_name('Stage'), self._stage_type(): {operator: value}}

    def list_views(self):
        results = []
        cursor = None
        while True:
            params = {'database_id': self.database_id, 'page_size': 100}
            if cursor:
                params['start_cursor'] = cursor
            response = self._request('GET', '/views', params=params)
            results.extend(response.get('results') or [])
            if not response.get('has_more'):
                break
            cursor = response.get('next_cursor')
        return results

    def _desired_views(self):
        stage_id = self._property_id('Stage')
        filming_id = self._property_id('Filming Date')
        publish_id = self._property_id('Publish Date')
        stage_type = self._stage_type()
        views = [
            {
                'name': 'Pipeline',
                'type': 'board',
                'filter': self._stage_filter('does_not_equal', 'Denied'),
                'configuration': {
                    'type': 'board',
                    'group_by': {
                        'type': stage_type,
                        'property_id': stage_id,
                        'group_by': 'option',
                        'sort': {'type': 'manual'},
                    },
                    'card_layout': 'compact',
                },
            },
            {
                'name': 'Idea Queue',
                'type': 'table',
                'filter': {
                    'or': [
                        self._stage_filter('equals', 'Idea Generation'),
                        self._stage_filter('equals', 'Idea Selection'),
                    ]
                },
                'sorts': [{'property': 'Impact', 'direction': 'descending'}],
            },
            {
                'name': 'Active Work',
                'type': 'table',
                'filter': {
                    'and': [
                        self._stage_filter('does_not_equal', 'Idea Generation'),
                        self._stage_filter('does_not_equal', 'Idea Selection'),
                        self._stage_filter('does_not_equal', 'Denied'),
                        self._stage_filter('does_not_equal', 'Shipped'),
                    ]
                },
                'sorts': [{'property': 'Filming Date', 'direction': 'ascending'}],
            },
            {
                'name': 'This Week',
                'type': 'table',
                'filter': {
                    'and': [
                        {'property': self._property_name('Publish Date'), 'date': {'this_week': {}}},
                        self._stage_filter('does_not_equal', 'Denied'),
                    ]
                },
                'sorts': [{'property': 'Publish Date', 'direction': 'ascending'}],
            },
            {
                'name': 'Shipped',
                'type': 'table',
                'filter': self._stage_filter('equals', 'Shipped'),
                'sorts': [{'property': 'Posted At', 'direction': 'descending'}],
            },
            {
                'name': 'Denied',
                'type': 'table',
                'filter': self._stage_filter('equals', 'Denied'),
            },
        ]
        if publish_id:
            views.append({
                'name': 'Publish Calendar',
                'type': 'calendar',
                'filter': {'property': self._property_name('Publish Date'), 'date': {'is_not_empty': True}},
                'configuration': {
                    'type': 'calendar',
                    'date_property_id': publish_id,
                    'view_range': 'month',
                    'show_weekends': True,
                },
            })
        if filming_id:
            views.append({
                'name': 'Filming Calendar',
                'type': 'calendar',
                'filter': {'property': self._property_name('Filming Date'), 'date': {'is_not_empty': True}},
                'configuration': {
                    'type': 'calendar',
                    'date_property_id': filming_id,
                    'view_range': 'month',
                    'show_weekends': True,
                },
            })
        if filming_id and publish_id:
            views.append({
                'name': 'Production Timeline',
                'type': 'timeline',
                'filter': {
                    'and': [
                        {'property': self._property_name('Filming Date'), 'date': {'is_not_empty': True}},
                        {'property': self._property_name('Publish Date'), 'date': {'is_not_empty': True}},
                    ]
                },
                'configuration': {
                    'type': 'timeline',
                    'date_property_id': filming_id,
                    'end_date_property_id': publish_id,
                    'show_table': True,
                },
            })
        return views

    def ensure_views(self):
        if self._views_result is not None:
            return self._views_result
        existing = {view.get('name'): view for view in self.list_views() if view.get('name')}
        created = []
        errors = []
        skipped = []
        source_id = self.resolve_data_source()
        for view in self._desired_views():
            if view['name'] in existing:
                skipped.append(view['name'])
                continue
            payload = {
                'database_id': self.database_id,
                'data_source_id': source_id,
                **view,
            }
            try:
                created.append(self._request('POST', '/views', json=payload).get('name') or view['name'])
            except NotionError as exc:
                errors.append({'name': view['name'], 'error': str(exc)})
        self._views_result = {
            'created': created,
            'existing': skipped,
            'errors': errors,
        }
        return self._views_result

    def ensure_schema(self):
        schema = self.get_schema(refresh=True)
        stage_actual = self._property_name('Stage')
        if stage_actual != 'Stage' and stage_actual in schema:
            self._request(
                'PATCH',
                f'/data_sources/{self.resolve_data_source()}',
                json={'properties': {stage_actual: {'name': 'Stage'}}},
            )
            schema = self.get_schema(refresh=True)

        missing = {
            name: definition
            for name, definition in PROPERTY_DEFINITIONS.items()
            if name not in schema
        }

        # Preserve existing Stage options while adding any missing pipeline stages.
        if 'Stage' in schema and schema['Stage'].get('type') in ('select', 'status'):
            prop_type = schema['Stage']['type']
            existing = schema['Stage'].get(prop_type, {}).get('options') or []
            existing_names = {option.get('name') for option in existing}
            additions = [name for name in STAGES if name not in existing_names]
            if additions:
                if prop_type == 'select':
                    missing['Stage'] = {
                        'select': {
                            'options': [
                                *[
                                    {'id': option['id']}
                                    for option in existing
                                    if option.get('id')
                                ],
                                *[{'name': name} for name in additions],
                            ]
                        }
                    }
                else:
                    missing['Stage'] = {
                        'status': {
                            'options': [
                                *[
                                    {'id': option['id']}
                                    for option in existing
                                    if option.get('id')
                                ],
                                *[{'name': name, 'group': 'To-do'} for name in additions],
                            ]
                        }
                    }
        elif 'Stage' in schema:
            raise NotionError('Existing Stage property must be a Select or Status field', 422)

        if missing:
            self._request(
                'PATCH',
                f'/data_sources/{self.resolve_data_source()}',
                json={'properties': missing},
            )
            schema = self.get_schema(refresh=True)
        try:
            views = self.ensure_views()
        except NotionError as exc:
            views = {'created': [], 'existing': [], 'errors': [{'name': '*', 'error': str(exc)}]}
        return {
            'ready': all(name in schema for name in PROPERTY_DEFINITIONS),
            'data_source_id': self.resolve_data_source(),
            'title_property': self._title_property,
            'properties': {
                name: prop.get('type')
                for name, prop in schema.items()
            },
            'added': list(missing),
            'views': views,
        }

    def _extract_property(self, props, name):
        actual = self._property_name(name)
        prop = props.get(actual) or props.get(name) or {}
        prop_type = prop.get('type')
        value = prop.get(prop_type) if prop_type else None
        if prop_type in ('title', 'rich_text'):
            return _plain_text(value)
        if prop_type in ('select', 'status'):
            return (value or {}).get('name')
        if prop_type == 'number':
            return value
        if prop_type == 'date':
            return (value or {}).get('start')
        if prop_type == 'url':
            return value
        if prop_type == 'people':
            return [
                {
                    'id': person.get('id'),
                    'name': person.get('name') or person.get('person', {}).get('email'),
                    'avatar_url': person.get('avatar_url'),
                }
                for person in (value or [])
            ]
        return None

    def normalize_page(self, page):
        props = page.get('properties') or {}
        stage_name = self._extract_property(props, 'Stage') or 'Idea Generation'
        stage_id = STAGE_TO_ID.get(stage_name, 'idea-generation')
        if stage_id == 'denied':
            decision = 'denied'
        elif stage_id in ('idea-generation', 'idea-selection'):
            decision = 'pending'
        else:
            decision = 'approved'
        return {
            'id': page['id'],
            'notionPageId': page['id'],
            'notionUrl': page.get('url'),
            'contentosId': self._extract_property(props, 'contentOS ID') or page['id'],
            'text': self._extract_property(props, self._title_property) or 'Untitled',
            'stage': stage_id,
            'stageName': stage_name,
            'decision': decision,
            'impact': self._extract_property(props, 'Impact') or 3,
            'effort': self._extract_property(props, 'Effort') or 3,
            'owner': self._extract_property(props, 'Owner') or [],
            'dueDate': self._extract_property(props, 'Due Date'),
            'filmingDate': self._extract_property(props, 'Filming Date') or self._extract_property(props, 'Due Date'),
            'data': {
                'script': self._extract_property(props, 'Draft') or '',
                'hook': self._extract_property(props, 'Hook') or '',
                'shotList': self._extract_property(props, 'Shot List') or '',
                'reviewNotes': self._extract_property(props, 'Review Notes') or '',
                'learning': self._extract_property(props, 'Learning') or '',
                'filmingDate': self._extract_property(props, 'Filming Date') or self._extract_property(props, 'Due Date'),
                'publishDate': self._extract_property(props, 'Publish Date'),
                'postedAt': self._extract_property(props, 'Posted At'),
                'liveUrl': self._extract_property(props, 'Live URL'),
            },
            'createdAt': page.get('created_time'),
            'updatedAt': page.get('last_edited_time'),
        }

    def list_content(self):
        self.ensure_schema()
        results = []
        cursor = None
        while True:
            body = {'page_size': 100}
            if cursor:
                body['start_cursor'] = cursor
            response = self._request(
                'POST',
                f'/data_sources/{self.resolve_data_source()}/query',
                json=body,
            )
            results.extend(self.normalize_page(page) for page in response.get('results') or [])
            if not response.get('has_more'):
                break
            cursor = response.get('next_cursor')
        return results

    def _stage_property(self, stage_id):
        schema = self.get_schema()
        actual = self._property_name('Stage')
        prop_type = (schema.get(actual) or schema.get('Stage') or {}).get('type', 'select')
        return {prop_type: {'name': ID_TO_STAGE[stage_id]}}

    def _properties_for(self, data, creating=False):
        properties = {}
        filming = _as_date(data.get('filmingDate')) if 'filmingDate' in data else None
        publish = _as_date(data.get('publishDate')) if 'publishDate' in data else None
        if filming and publish and filming > publish:
            raise NotionError('Filming date must be on or before publish date', 400)
        if 'text' in data:
            properties[self._title_property] = {'title': _rich_text(str(data['text']).strip())}
        if 'stage' in data:
            if data['stage'] not in ID_TO_STAGE:
                raise NotionError(f'Invalid stage: {data["stage"]}', 400)
            properties[self._property_name('Stage')] = self._stage_property(data['stage'])
        for field, notion_name in (('impact', 'Impact'), ('effort', 'Effort')):
            if field in data:
                value = int(data[field])
                if value < 1 or value > 5:
                    raise NotionError(f'{field} must be between 1 and 5', 400)
                properties[self._property_name(notion_name)] = {'number': value}
        payload = data
        if 'filmingDate' in data and 'dueDate' not in data:
            payload = {**data, 'dueDate': data.get('filmingDate')}
        for field, notion_name in (
            ('dueDate', 'Due Date'),
            ('filmingDate', 'Filming Date'),
            ('publishDate', 'Publish Date'),
            ('postedAt', 'Posted At'),
        ):
            if field in payload:
                start = _as_date(payload[field])
                properties[self._property_name(notion_name)] = {'date': {'start': start} if start else None}
        if 'liveUrl' in data:
            properties[self._property_name('Live URL')] = {'url': data['liveUrl'] or None}
        for field, notion_name in (
            ('draft', 'Draft'),
            ('hook', 'Hook'),
            ('shotList', 'Shot List'),
            ('reviewNotes', 'Review Notes'),
            ('learning', 'Learning'),
        ):
            if field in data:
                properties[self._property_name(notion_name)] = {'rich_text': _rich_text(str(data[field]))}
        if creating:
            properties[self._property_name('contentOS ID')] = {
                'rich_text': _rich_text(data.get('contentosId') or str(uuid.uuid4()))
            }
        return properties

    def find_by_contentos_id(self, contentos_id):
        if not contentos_id:
            return None
        response = self._request(
            'POST',
            f'/data_sources/{self.resolve_data_source()}/query',
            json={
                'page_size': 1,
                'filter': {
                    'property': 'contentOS ID',
                    'rich_text': {'equals': contentos_id},
                },
            },
        )
        pages = response.get('results') or []
        return self.normalize_page(pages[0]) if pages else None

    def create_content(self, data):
        self.ensure_schema()
        text = str(data.get('text') or '').strip()
        if not text:
            raise NotionError('text is required', 400)
        contentos_id = data.get('contentosId')
        existing = self.find_by_contentos_id(contentos_id) if contentos_id else None
        if existing:
            return existing, False
        payload = {**data, 'text': text, 'stage': data.get('stage') or 'idea-generation'}
        page = self._request(
            'POST',
            '/pages',
            json={
                'parent': {
                    'type': 'data_source_id',
                    'data_source_id': self.resolve_data_source(),
                },
                'properties': self._properties_for(payload, creating=True),
            },
        )
        return self.normalize_page(page), True

    def update_content(self, page_id, data):
        self.ensure_schema()
        allowed = {
            'text', 'stage', 'impact', 'effort', 'dueDate', 'filmingDate', 'publishDate',
            'postedAt', 'liveUrl', 'draft', 'hook', 'shotList', 'reviewNotes', 'learning',
        }
        unknown = set(data) - allowed
        if unknown:
            raise NotionError(f'Unsupported fields: {", ".join(sorted(unknown))}', 400)
        if not data:
            raise NotionError('No fields to update', 400)
        page = self._request(
            'PATCH',
            f'/pages/{page_id}',
            json={'properties': self._properties_for(data)},
        )
        return self.normalize_page(page)

    def archive_content(self, page_id):
        self._request('PATCH', f'/pages/{page_id}', json={'archived': True, 'in_trash': True})
        return {'id': page_id, 'archived': True}

    def status(self, ensure=False):
        result = {
            'configured': self.configured,
            'database_id': self.database_id if self.configured else None,
        }
        if not self.configured:
            return result
        try:
            details = self.ensure_schema() if ensure else {
                'data_source_id': self.resolve_data_source(),
                'properties': {
                    name: prop.get('type')
                    for name, prop in self.get_schema().items()
                },
                'title_property': self._title_property,
            }
            result.update(details)
            result['accessible'] = True
        except NotionError as exc:
            result.update({'accessible': False, 'error': str(exc)})
        return result
