import { object, string } from 'cast.ts'
import { Memo, proxy } from '../../../db/proxy.js'
import { apiEndpointTitle, title } from '../../config.js'
import { Link, Redirect } from '../components/router.js'
import Style from '../components/style.js'
import {
  Context,
  DynamicContext,
  WsContext,
  getContextFormBody,
} from '../context.js'
import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import { getAuthUserId } from '../auth/user.js'
import { renderError } from '../components/error.js'
import { mapArray } from '../components/fragment.js'
import { EarlyTerminate } from '../helpers.js'
import { find } from 'better-sqlite3-proxy'
import { sendUpdateMessage } from '../components/update-message.js'
import { getWSSession, sessions } from '../session.js'

let content = (
  <div id="MemoPage">
    {Style(/* css */ `
.memo-list {

}
.memo-card {
	border: 1px solid black;
	width: fit-content;
	min-width: 200px;
	min-height: 200px;
	padding: 1rem;
	display: inline-block;
}
.memo-card textarea {
	display: block;
}
.memo-card--top-bar {
	display: flex;
	justify-content: space-between;
}
.submit-line {
	margin-top: 1rem
}
`)}
    <h1>Memo List</h1>
    <MemoList />
    <h2>Add New Memo</h2>
    <SubmitMemoForm />
  </div>
)

function MemoList() {
  return (
    <div>
      <h2>Recent Memos</h2>
      <div class="memo-list">
        {mapArray(proxy.memo, memo => (
          <MemoCard memo={memo} />
        ))}
      </div>
    </div>
  )
}

function MemoCard(attrs: { memo: Memo }, context: Context) {
  let user_id = getAuthUserId(context)
  let memo = attrs.memo
  return (
    <div class="memo-card" data-memo-id={memo.id}>
      <div class="memo-card--top-bar">
        <div>#{memo.id}</div>
        <div>
          {user_id == memo.user_id ? (
            <button onclick={`emit('/memo/${memo.id}/delete',1,2,3)`}>
              Delete
            </button>
          ) : null}
        </div>
      </div>
      <div>
        {user_id == memo.user_id ? (
          <>
            <textarea rows="9">{memo.content}</textarea>
            <button
              onclick={`emit('/memo/${memo.id}/update',this.previousElementSibling.value)`}
            >
              update
            </button>
            <p class="update-message"></p>
          </>
        ) : (
          <div class="memo-content">{memo.content}</div>
        )}
      </div>
    </div>
  )
}

function SubmitMemoForm(_attrs: {}, context: Context) {
  let user_id = getAuthUserId(context)
  if (!user_id)
    return (
      <div>
        <p>
          You can submit your memo after <Link href="/login">login</Link> or{' '}
          <Link href="/register">register</Link>.
        </p>
      </div>
    )
  return (
    <form method="post" action="/memo/submit" onsubmit="emitForm(event)">
      <textarea name="content" cols="30" rows="10"></textarea>
      <div class="submit-line">
        <input type="submit" value="Add Memo" />
      </div>
      <p class="submit-message"></p>
    </form>
  )
}

let submitParser = object({
  content: string({ nonEmpty: true, minLength: 5 }),
})

function SubmitMemo(_attrs: {}, context: DynamicContext) {
  let user_id = getAuthUserId(context)
  if (!user_id) {
    return (
      <div>
        <p>Please login before submitting a memo.</p>
        <p>
          Go to <Link href="/login">login page</Link>
        </p>
      </div>
    )
  }
  try {
    let body = getContextFormBody(context)
    let input = submitParser.parse(body, { name: 'form_body' })
    console.log('body:', body)
    let memo_id = proxy.memo.push({
      user_id,
      content: input.content,
    })
    if (context.type == 'ws') {
      context.ws.send([
        'batch',
        [
          ['update-props', '#MemoPage form textarea', { value: '' }],
          [
            'update-text',
            '#MemoPage form .submit-message',
            'Submitted memo #' + memo_id,
          ],
          [
            'append',
            '#MemoPage .memo-list',
            MemoCard({ memo: proxy.memo[memo_id] }, context),
          ],
        ],
      ])

      throw EarlyTerminate
    }
    return (
      <div>
        <p>Received</p>
        <p>
          Back to <Link href="/memo">memo list</Link>
        </p>
      </div>
    )
  } catch (error) {
    if (error == EarlyTerminate) throw error
    return (
      <div>
        {renderError(error, context)}
        <Link href="/memo">
          <button>Retry</button>
        </Link>
      </div>
    )
  }
}

function DeleteMemo(_attrs: {}, context: WsContext) {
  let memo_id = context.routerMatch?.params.id
  let user_id = getAuthUserId(context)
  if (!user_id) {
    throw new Error('please login first')
  }
  let row = find(proxy.memo, {
    id: memo_id,
    user_id,
  })
  if (row) {
    delete proxy.memo[memo_id]
    context.ws.send(['remove', `[data-memo-id="${memo_id}"]`])
  }
  throw EarlyTerminate
}

function UpdateMemo(_attrs: {}, context: WsContext) {
  let memo_id = context.routerMatch?.params.id

  let user_id = getAuthUserId(context)
  if (!user_id) throw new Error('please login first')

  let content = context.args?.[0] as string
  if (!content) throw EarlyTerminate

  let row = find(proxy.memo, {
    id: memo_id,
    user_id,
  })
  if (!row) throw EarlyTerminate

  row.content = content
  sendUpdateMessage(
    {
      label: 'content',
      selector: `[data-memo-id="${memo_id}"] .update-message`,
    },
    context,
  )
  for (let session of sessions.values()) {
    if (session.url?.startsWith('/memo')) {
      session.ws.send([
        'update-all-text',
        `[data-memo-id="${memo_id}"] .memo-content`,
        content,
      ])
    }
  }
  throw EarlyTerminate
}

let routes: Routes = {
  '/memo': {
    title: title('Memo'),
    description: `Share your content with the internet`,
    menuText: 'Memo',
    node: content,
  },
  '/memo/submit': {
    title: apiEndpointTitle,
    description: `create new memo by user`,
    node: <SubmitMemo />,
  },
  '/memo/:id/delete': {
    title: apiEndpointTitle,
    description: `delete memo by id`,
    node: <DeleteMemo />,
  },
  '/memo/:id/update': {
    title: apiEndpointTitle,
    description: `update memo content by id`,
    node: <UpdateMemo />,
  },
}

export default { routes }
