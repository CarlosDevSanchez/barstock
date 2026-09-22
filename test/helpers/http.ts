import { mock } from 'bun:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { NextRequest } from 'next/server'
import { ensureTestUsers, TEST_PASSWORD, type TestRole } from './integration'

// The handlers read the session through next/headers `cookies()`. In a test there is no Next request scope, so each call
// runs inside an AsyncLocalStorage that carries THAT client's cookie jar: several clients can be used concurrently.
type Jar = Map<string, string> & { options?: Map<string, Record<string, unknown>> }
const jars = new AsyncLocalStorage<Jar>()

void mock.module('next/headers', () => ({
    cookies: async () => {
        const jar = jars.getStore()
        if (!jar) throw new Error('cookies() was called outside of a test request')
        return {
            getAll: () => [...jar].map(([name, value]) => ({ name, value })),
            get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
            set: (name: string, value: string, options?: { maxAge?: number; expires?: Date }) => {
                const expired = options?.maxAge === 0 || (options?.expires && options.expires.getTime() <= Date.now())
                if (value === '' || expired) jar.delete(name)
                else jar.set(name, value)
                // Kept so tests can assert on the attributes (HttpOnly, SameSite, ...).
                jar.options ??= new Map()
                jar.options.set(name, { ...options })
            }
        }
    }
}))

export const ORIGIN = 'http://localhost:3000'

export interface ApiResponse {
    status: number
    headers: Headers
    text: string
    json: <T = Record<string, unknown>>() => T
}

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

interface CallOptions {
    body?: unknown
    /** Raw body (e.g. malformed JSON). */
    rawBody?: string
    /** Multipart body (image upload endpoints): the `Request` sets its own boundary Content-Type. */
    formData?: FormData
    params?: Record<string, string>
    headers?: Record<string, string>
    /** Sent as `Origin`; null omits it. Defaults to the app's own origin. */
    origin?: string | null
}

export class TestClient {
    readonly jar: Jar = new Map()

    /** Attributes of the cookies the server set for this client (name -> options). */
    get cookieOptions(): Map<string, Record<string, unknown>> {
        return this.jar.options ?? new Map()
    }

    async call(handler: Handler, method: string, path: string, options: CallOptions = {}): Promise<ApiResponse> {
        const headers: Record<string, string> = { host: 'localhost:3000', ...options.headers }
        if (options.origin !== null) headers.origin = options.origin ?? ORIGIN
        const raw = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
        if (options.formData === undefined && raw !== undefined) headers['content-type'] = 'application/json'

        const request = new Request(`${ORIGIN}/api/v1/${path}`, { method, headers, body: options.formData ?? raw })
        const context = options.params ? { params: Promise.resolve(options.params) } : undefined
        const response = await jars.run(this.jar, () => handler(request, context))
        const text = await response.text()
        return {
            status: response.status,
            headers: response.headers,
            text,
            json: <T>() => JSON.parse(text) as T
        }
    }

    get = (handler: Handler, path: string, options?: CallOptions) => this.call(handler, 'GET', path, options)
    post = (handler: Handler, path: string, options?: CallOptions) => this.call(handler, 'POST', path, options)
    patch = (handler: Handler, path: string, options?: CallOptions) => this.call(handler, 'PATCH', path, options)
    delete = (handler: Handler, path: string, options?: CallOptions) => this.call(handler, 'DELETE', path, options)

    /** Runs a Next route handler that takes a NextRequest (the /auth/confirm redirect) with this client's cookies. */
    async visit(handler: (request: NextRequest) => Promise<Response>, url: URL): Promise<Response> {
        return jars.run(this.jar, () => handler(new NextRequest(url)))
    }

    /** Same call as any other client, but with the session cookies removed (an anonymous visitor). */
    static anonymous = () => new TestClient()
}

/** A client signed in through the REAL login handler, so it holds real session cookies. */
export async function loginAs(role: TestRole | 'inactive'): Promise<TestClient> {
    const users = await ensureTestUsers()
    const { POST } = await import('@/app/api/v1/auth/login/route')
    const client = new TestClient()
    const response = await client.post(POST, 'auth/login', {
        body: { email: users[role].email, password: TEST_PASSWORD }
    })
    if (role !== 'inactive' && response.status !== 200) throw new Error(`login as ${role} failed: ${response.text}`)
    return client
}

type Envelope<T> = { data: T }
export const dataOf = <T>(response: ApiResponse): T => response.json<Envelope<T>>().data
export const errorOf = (response: ApiResponse) =>
    response.json<{ error: { code: string; message: string; details?: unknown } }>().error
