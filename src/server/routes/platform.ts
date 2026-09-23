import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import {
  requireSuperAdmin,
  requireCompanyUser,
  requirePasswordChanged
} from '../middleware/session';
import {
  createCompanyAccessSession,
  getCookie,
  revokeCompanyAccess
} from '../auth/session';
import { audit } from '../audit';
import { hashPassword, sha256, verifyPassword } from '../auth/crypto';
import { hasPermission } from '../authorization';

const app = new Hono<Env>();

app.use('*', requirePasswordChanged);

/*
 * Company input
 *
 * The database uses:
 * active / suspended / archived
 *
 * The old UI may still send:
 * managementStatus = active / inactive
 *
 * We accept both so the existing frontend does not need to be rebuilt.
 */

const companyInputSchema = z.object({
  companyIdentifier: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{2,32}$/),

  legalName: z
    .string()
    .trim()
    .min(2)
    .max(200),

  displayName: z
    .string()
    .trim()
    .min(2)
    .max(200),

  status: z
    .enum(['active', 'suspended', 'archived'])
    .optional(),

  managementStatus: z
    .enum(['active', 'inactive'])
    .optional()
});

const adminSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1)
    .max(128),

  password: z
    .string()
    .min(8)
    .max(256),

  displayName: z
    .string()
    .trim()
    .min(2)
    .max(200),

  employeeId: z
    .string()
    .trim()
    .max(128)
    .optional()
    .nullable()
});

const createCompanySchema = companyInputSchema
  .extend({
    admin: adminSchema.optional()
  })
  .transform((data) => ({
    ...data,
    status:
      data.status ??
      (data.managementStatus === 'inactive'
        ? 'suspended'
        : 'active')
  }));

const updateCompanySchema = companyInputSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    { message: 'EMPTY_UPDATE' }
  )
  .transform((data) => ({
    ...data,
    status:
      data.status ??
      (data.managementStatus === 'inactive'
        ? 'suspended'
        : data.managementStatus === 'active'
          ? 'active'
          : undefined)
  }));


async function companyById(c: any, companyId: string) {
  return c.env.DB
    .prepare(`
      SELECT
        id,
        company_identifier,
        legal_name,
        display_name,
        status,
        status AS management_status,
        created_at,
        updated_at
      FROM companies
      WHERE id=?
    `)
    .bind(companyId)
    .first<any>();
}


async function activeCompanyAdmin(
  c: any,
  companyId: string
) {
  /*
   * company_users does NOT contain display_name.
   * Do not select it from that table.
   */
  return c.env.DB
    .prepare(`
      SELECT
        cu.id,
        cu.username,
        NULL AS display_name,
        cu.employee_id,
        cu.status
      FROM company_users cu
      JOIN user_roles ur
        ON ur.company_user_id=cu.id
      JOIN roles r
        ON r.id=ur.role_id
      WHERE cu.company_id=?
        AND cu.status='active'
        AND r.code='company_admin'
        AND r.status='active'
      LIMIT 1
    `)
    .bind(companyId)
    .first<any>();
}


/* =========================================================
   COMPANY LIST
   ========================================================= */

app.get(
  '/companies',
  requireSuperAdmin,
  async c => {
    const search = (c.req.query('search') ?? '').trim();
    const status = c.req.query('status') ?? '';

    const params: any[] = [];
    const where: string[] = [];

    if (search) {
      where.push(`
        (
          c.company_identifier LIKE ?
          OR c.display_name LIKE ?
          OR c.legal_name LIKE ?
        )
      `);

      const q = `%${search}%`;

      params.push(q, q, q);
    }

    /*
     * Support both the actual DB statuses and the old
     * active/inactive UI filter.
     */
    if (
      status === 'active' ||
      status === 'suspended' ||
      status === 'archived'
    ) {
      where.push('c.status=?');
      params.push(status);
    } else if (status === 'inactive') {
      where.push(`c.status IN ('suspended','archived')`);
    }

    const sql = `
      SELECT
        c.id,
        c.company_identifier,
        c.legal_name,
        c.display_name,
        c.status,
        c.status AS management_status,
        c.created_at,

        EXISTS(
          SELECT 1
          FROM company_users cu
          JOIN user_roles ur
            ON ur.company_user_id=cu.id
          JOIN roles r
            ON r.id=ur.role_id
          WHERE cu.company_id=c.id
            AND cu.status='active'
            AND r.code='company_admin'
            AND r.status='active'
        ) AS has_company_admin

      FROM companies c

      ${where.length
        ? `WHERE ${where.join(' AND ')}`
        : ''}

      ORDER BY c.created_at DESC
    `;

    const rows = await c.env.DB
      .prepare(sql)
      .bind(...params)
      .all<any>();

    return c.json({
      items: rows.results
    });
  }
);


/* =========================================================
   COMPANY DETAILS
   ========================================================= */

app.get(
  '/companies/:companyId',
  requireSuperAdmin,
  async c => {
    const companyId = c.req.param('companyId');

    const company = await companyById(
      c,
      companyId
    );

    if (!company) {
      return c.json(
        { error: 'COMPANY_NOT_FOUND' },
        404
      );
    }

    const admin = await activeCompanyAdmin(
      c,
      companyId
    );

    const recentRequests = await c.env.DB
      .prepare(`
        SELECT
          r.id,
          r.status,
          r.reason,
          r.requested_at,
          r.approved_at,
          r.rejected_at,
          r.expires_at,
          pu.display_name AS super_admin_name
        FROM company_access_requests r
        JOIN platform_users pu
          ON pu.id=r.super_admin_user_id
        WHERE r.company_id=?
        ORDER BY r.requested_at DESC
        LIMIT 10
      `)
      .bind(companyId)
      .all<any>();

    return c.json({
      company,
      admin: admin ?? null,
      recentRequests: recentRequests.results
    });
  }
);


/* =========================================================
   CREATE COMPANY
   ========================================================= */

app.post(
  '/companies',
  requireSuperAdmin,
  async c => {
    const parsed = createCompanySchema.safeParse(
      await c.req.json().catch(() => null)
    );

    if (!parsed.success) {
      return c.json(
        { error: 'INVALID_INPUT' },
        400
      );
    }

    const id = crypto.randomUUID();

    const admin = parsed.data.admin;

    const adminId = admin
      ? crypto.randomUUID()
      : null;

    const roleId = admin
      ? crypto.randomUUID()
      : null;

    const passwordHash = admin
      ? await hashPassword(admin.password)
      : null;

    try {
      const statements = [
        c.env.DB.prepare(`
          INSERT INTO companies(
            id,
            company_identifier,
            legal_name,
            display_name,
            status
          )
          VALUES(?,?,?,?,?)
        `).bind(
          id,
          parsed.data.companyIdentifier,
          parsed.data.legalName,
          parsed.data.displayName,
          parsed.data.status
        )
      ];

      /*
       * Create Company Admin when supplied.
       */
      if (
        admin &&
        adminId &&
        roleId &&
        passwordHash
      ) {

        /*
         * company_users has NO display_name column.
         *
         * displayName is accepted from the UI for compatibility,
         * but is not inserted because the current DB schema
         * does not contain that column.
         */
        statements.push(
          c.env.DB.prepare(`
            INSERT INTO company_users(
              id,
              company_id,
              username,
              employee_id,
              password_hash,
              must_change_password,
              status
            )
            VALUES(?,?,?,?,?,1,'active')
          `).bind(
            adminId,
            id,
            admin.username,
            admin.employeeId ?? null,
            passwordHash
          )
        );

        /*
         * Company Admin role.
         */
        statements.push(
          c.env.DB.prepare(`
            INSERT INTO roles(
              id,
              company_id,
              name_ar,
              name_en,
              code,
              system_role
            )
            VALUES(?,?,?,?,?,1)
          `).bind(
            roleId,
            id,
            'مدير الشركة',
            'Company Admin',
            'company_admin'
          )
        );

        /*
         * Assign role to Company Admin.
         */
        statements.push(
          c.env.DB.prepare(`
            INSERT INTO user_roles(
              company_user_id,
              role_id
            )
            VALUES(?,?)
          `).bind(
            adminId,
            roleId
          )
        );

        /*
         * Give Company Admin all currently defined permissions
         * within company scope.
         */
        const permissions = await c.env.DB
          .prepare(`
            SELECT id
            FROM permissions
          `)
          .all<{ id: string }>();

        for (const permission of permissions.results) {
          statements.push(
            c.env.DB.prepare(`
              INSERT INTO role_permissions(
                role_id,
                permission_id,
                scope
              )
              VALUES(?,?,?)
            `).bind(
              roleId,
              permission.id,
              'company'
            )
          );
        }
      }

      /*
       * Batch ensures the company and its related records
       * are committed together.
       */
      await c.env.DB.batch(statements);

    } catch (err) {
      const message = String(err);

      if (
        message.includes('UNIQUE constraint failed') ||
        message.includes('UNIQUE')
      ) {
        return c.json(
          {
            error: 'COMPANY_IDENTIFIER_EXISTS'
          },
          409
        );
      }

      console.error(
        'COMPANY_CREATE_FAILED',
        err
      );

      return c.json(
        {
          error: 'COMPANY_CREATE_FAILED'
        },
        500
      );
    }

    /*
     * Audit only after successful DB transaction.
     */
    await audit(
      c,
      'company_create',
      'company',
      id,
      {
        companyIdentifier:
          parsed.data.companyIdentifier,
        hasCompanyAdmin:
          Boolean(admin)
      }
    );

    if (admin) {
      await audit(
        c,
        'company_admin_create',
        'company_user',
        adminId!,
        {
          companyId: id
        }
      );
    }

    return c.json(
      {
        ok: true,
        id,
        adminId
      },
      201
    );
  }
);


/* =========================================================
   UPDATE COMPANY
   ========================================================= */

app.patch(
  '/companies/:companyId',
  requireSuperAdmin,
  async c => {
    const companyId =
      c.req.param('companyId');

    const parsed =
      updateCompanySchema.safeParse(
        await c.req.json().catch(() => null)
      );

    if (!parsed.success) {
      return c.json(
        { error: 'INVALID_INPUT' },
        400
      );
    }

    const before = await companyById(
      c,
      companyId
    );

    if (!before) {
      return c.json(
        { error: 'COMPANY_NOT_FOUND' },
        404
      );
    }

    const data = parsed.data;

    const fields: string[] = [];
    const values: any[] = [];

    if (
      data.companyIdentifier !== undefined
    ) {
      fields.push(
        'company_identifier=?'
      );
      values.push(
        data.companyIdentifier
      );
    }

    if (data.legalName !== undefined) {
      fields.push(
        'legal_name=?'
      );
      values.push(
        data.legalName
      );
    }

    if (data.displayName !== undefined) {
      fields.push(
        'display_name=?'
      );
      values.push(
        data.displayName
      );
    }

    if (data.status !== undefined) {
      fields.push(
        'status=?'
      );
      values.push(
        data.status
      );
    }

    fields.push(
      'updated_at=CURRENT_TIMESTAMP'
    );

    values.push(companyId);

    try {
      await c.env.DB
        .prepare(`
          UPDATE companies
          SET ${fields.join(',')}
          WHERE id=?
        `)
        .bind(...values)
        .run();

    } catch (err) {
      const message = String(err);

      if (
        message.includes('UNIQUE constraint failed') ||
        message.includes('UNIQUE')
      ) {
        return c.json(
          {
            error:
              'COMPANY_IDENTIFIER_EXISTS'
          },
          409
        );
      }

      console.error(
        'COMPANY_UPDATE_FAILED',
        err
      );

      return c.json(
        {
          error:
            'COMPANY_UPDATE_FAILED'
        },
        500
      );
    }

    /*
     * When a company becomes suspended/archived,
     * revoke company access sessions.
     */
    if (
      data.status !== undefined &&
      data.status !== 'active' &&
      before.status === 'active'
    ) {

      await c.env.DB
        .prepare(`
          UPDATE company_access_sessions
          SET revoked_at=CURRENT_TIMESTAMP
          WHERE company_id=?
            AND revoked_at IS NULL
        `)
        .bind(companyId)
        .run();

      await c.env.DB
        .prepare(`
          UPDATE sessions
          SET revoked_at=CURRENT_TIMESTAMP
          WHERE session_type='company'
            AND company_user_id IN (
              SELECT id
              FROM company_users
              WHERE company_id=?
            )
            AND revoked_at IS NULL
        `)
        .bind(companyId)
        .run();

      await c.env.DB
        .prepare(`
          UPDATE company_access_requests
          SET
            status='revoked',
            revoked_at=CURRENT_TIMESTAMP
          WHERE company_id=?
            AND status='pending'
        `)
        .bind(companyId)
        .run();
    }

    await audit(
      c,
      'company_update',
      'company',
      companyId,
      {
        before: {
          status: before.status
        },
        after: data
      }
    );

    return c.json({
      ok: true
    });
  }
);


/* =========================================================
   CREATE / REPLACE COMPANY ADMIN
   ========================================================= */

app.post(
  '/companies/:companyId/admins',
  requireSuperAdmin,
  async c => {

    const parsed =
      adminSchema.safeParse(
        await c.req.json().catch(() => null)
      );

    if (!parsed.success) {
      return c.json(
        { error: 'INVALID_INPUT' },
        400
      );
    }

    const company =
      await companyById(
        c,
        c.req.param('companyId')
      );

    if (!company) {
      return c.json(
        { error: 'COMPANY_NOT_FOUND' },
        404
      );
    }

    const userId =
      crypto.randomUUID();

    const roleId =
      crypto.randomUUID();

    try {
      const permissions =
        await c.env.DB
          .prepare(`
            SELECT id
            FROM permissions
          `)
          .all<{ id: string }>();

      const statements = [
        c.env.DB.prepare(`
          INSERT INTO company_users(
            id,
            company_id,
            username,
            employee_id,
            password_hash,
            must_change_password,
            status
          )
          VALUES(?,?,?,?,?,1,'active')
        `).bind(
          userId,
          company.id,
          parsed.data.username,
          parsed.data.employeeId ?? null,
          await hashPassword(
            parsed.data.password
          )
        ),

        c.env.DB.prepare(`
          INSERT INTO roles(
            id,
            company_id,
            name_ar,
            name_en,
            code,
            system_role
          )
          VALUES(?,?,?,?,?,1)
        `).bind(
          roleId,
          company.id,
          'مدير الشركة',
          'Company Admin',
          'company_admin'
        ),

        c.env.DB.prepare(`
          INSERT INTO user_roles(
            company_user_id,
            role_id
          )
          VALUES(?,?)
        `).bind(
          userId,
          roleId
        ),

        ...permissions.results.map(
          permission =>
            c.env.DB.prepare(`
              INSERT INTO role_permissions(
                role_id,
                permission_id,
                scope
              )
              VALUES(?,?,?)
            `).bind(
              roleId,
              permission.id,
              'company'
            )
        )
      ];

      await c.env.DB.batch(
        statements
      );

    } catch (err) {
      const message = String(err);

      if (
        message.includes(
          'UNIQUE constraint failed'
        ) ||
        message.includes('UNIQUE')
      ) {
        return c.json(
          {
            error: 'USERNAME_EXISTS'
          },
          409
        );
      }

      console.error(
        'COMPANY_ADMIN_CREATE_FAILED',
        err
      );

      return c.json(
        {
          error:
            'COMPANY_ADMIN_CREATE_FAILED'
        },
        500
      );
    }

    await audit(
      c,
      'company_admin_create',
      'company_user',
      userId,
      {
        companyId: company.id
      }
    );

    return c.json(
      {
        ok: true,
        userId
      },
      201
    );
  }
);


/* =========================================================
   COMPANY USER MANAGEMENT
   ========================================================= */

app.get(
  '/companies/:companyId/users',
  requireSuperAdmin,
  async c => {
    const companyId = c.req.param('companyId');
    const company = await companyById(c, companyId);
    if (!company) return c.json({ error: 'COMPANY_NOT_FOUND' }, 404);

    const rows = await c.env.DB.prepare(`
      SELECT
        cu.id,
        cu.username,
        cu.employee_id,
        cu.must_change_password,
        cu.status,
        cu.last_login_at,
        cu.failed_login_count,
        cu.created_at,
        GROUP_CONCAT(r.code) AS roles
      FROM company_users cu
      LEFT JOIN user_roles ur ON ur.company_user_id=cu.id
      LEFT JOIN roles r ON r.id=ur.role_id
      WHERE cu.company_id=?
      GROUP BY cu.id
      ORDER BY cu.created_at DESC
    `).bind(companyId).all<any>();

    return c.json({
      items: rows.results.map((u:any) => ({
        ...u,
        must_change_password: Boolean(u.must_change_password),
        roles: u.roles ? String(u.roles).split(',') : []
      }))
    });
  }
);

const updateCompanyUserSchema = z.object({
  username: z.string().trim().min(1).max(128).optional(),
  employeeId: z.string().trim().max(128).nullable().optional(),
  status: z.enum(['active','inactive','locked']).optional()
}).refine(v => Object.keys(v).length > 0, { message: 'EMPTY_UPDATE' });

app.patch(
  '/companies/:companyId/users/:userId',
  requireSuperAdmin,
  async c => {
    const companyId = c.req.param('companyId');
    const userId = c.req.param('userId');
    const parsed = updateCompanyUserSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'INVALID_INPUT' }, 400);

    const company = await companyById(c, companyId);
    if (!company) return c.json({ error: 'COMPANY_NOT_FOUND' }, 404);

    const before = await c.env.DB.prepare(`
      SELECT id,username,employee_id,status
      FROM company_users
      WHERE id=? AND company_id=?
    `).bind(userId, companyId).first<any>();
    if (!before) return c.json({ error: 'COMPANY_USER_NOT_FOUND' }, 404);

    const fields:string[]=[];
    const values:any[]=[];
    if (parsed.data.username !== undefined) { fields.push('username=?'); values.push(parsed.data.username); }
    if (parsed.data.employeeId !== undefined) { fields.push('employee_id=?'); values.push(parsed.data.employeeId); }
    if (parsed.data.status !== undefined) { fields.push('status=?'); values.push(parsed.data.status); }
    fields.push('updated_at=CURRENT_TIMESTAMP');
    values.push(userId);

    try {
      await c.env.DB.prepare(`UPDATE company_users SET ${fields.join(',')} WHERE id=?`).bind(...values).run();
      if (parsed.data.status && parsed.data.status !== 'active') {
        await c.env.DB.prepare(`UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE session_type='company' AND company_user_id=? AND revoked_at IS NULL`).bind(userId).run();
      }
    } catch (err) {
      const message=String(err);
      if (message.includes('UNIQUE')) return c.json({ error: 'USERNAME_EXISTS' }, 409);
      console.error('COMPANY_USER_UPDATE_FAILED', err);
      return c.json({ error: 'COMPANY_USER_UPDATE_FAILED' }, 500);
    }

    await audit(c, 'company_user_update', 'company_user', userId, {
      companyId,
      before,
      after: parsed.data
    });
    return c.json({ ok:true });
  }
);

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(256)
});

app.post(
  '/companies/:companyId/users/:userId/reset-password',
  requireSuperAdmin,
  async c => {
    const companyId = c.req.param('companyId');
    const userId = c.req.param('userId');
    const parsed = resetPasswordSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'INVALID_INPUT' }, 400);

    const user = await c.env.DB.prepare(`
      SELECT id,username,status
      FROM company_users
      WHERE id=? AND company_id=?
    `).bind(userId, companyId).first<any>();
    if (!user) return c.json({ error: 'COMPANY_USER_NOT_FOUND' }, 404);

    try {
      await c.env.DB.prepare(`
        UPDATE company_users
        SET password_hash=?,must_change_password=1,status='active',failed_login_count=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND company_id=?
      `).bind(await hashPassword(parsed.data.newPassword), userId, companyId).run();
      await c.env.DB.prepare(`UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE session_type='company' AND company_user_id=? AND revoked_at IS NULL`).bind(userId).run();
    } catch (err) {
      console.error('COMPANY_USER_PASSWORD_RESET_FAILED', err);
      return c.json({ error: 'PASSWORD_RESET_FAILED' }, 500);
    }

    await audit(c, 'company_user_password_reset', 'company_user', userId, { companyId });
    return c.json({ ok:true, mustChangePassword:true });
  }
);

/* =========================================================
   SUPER ADMIN COMPANY ACCESS REQUEST
   ========================================================= */

app.post(
  '/companies/:companyId/access-request',
  requireSuperAdmin,
  async c => {

    const companyId =
      c.req.param('companyId');

    const parsed = z.object({
      reason: z
        .string()
        .trim()
        .min(3)
        .max(500)
    }).safeParse(
      await c.req.json().catch(
        () => ({})
      )
    );

    if (!parsed.success) {
      return c.json(
        { error: 'INVALID_INPUT' },
        400
      );
    }

    const company =
      await companyById(
        c,
        companyId
      );

    if (
      !company ||
      company.status !== 'active'
    ) {
      return c.json(
        {
          error:
            'COMPANY_INACTIVE'
        },
        409
      );
    }

    const current =
      await c.env.DB
        .prepare(`
          SELECT
            id,
            status
          FROM company_access_requests
          WHERE super_admin_user_id=?
            AND company_id=?
            AND status='pending'
          LIMIT 1
        `)
        .bind(
          c.get('session')!.platformUserId,
          companyId
        )
        .first<any>();

    if (current) {
      return c.json({
        ok: true,
        status: 'pending',
        requestId: current.id
      });
    }

    const admin =
      await activeCompanyAdmin(
        c,
        companyId
      );

    const requestId =
      crypto.randomUUID();

    /*
     * If there is no Company Admin,
     * Super Admin gets direct temporary access.
     */
    if (!admin) {

      const expires =
        new Date(
          Date.now() +
          60 * 60 * 1000
        ).toISOString();

      await c.env.DB
        .prepare(`
          INSERT INTO company_access_requests(
            id,
            super_admin_user_id,
            company_id,
            approved_at,
            expires_at,
            status,
            reason
          )
          VALUES(
            ?,
            ?,
            ?,
            ?,
            ?,
            'approved',
            ?
          )
        `)
        .bind(
          requestId,
          c.get('session')!
            .platformUserId,
          companyId,
          new Date().toISOString(),
          expires,
          parsed.data.reason
        )
        .run();

      await createCompanyAccessSession(
        c,
        requestId,
        c.get('session')!
          .platformUserId!,
        companyId
      );

      await audit(
        c,
        'company_access_started',
        'company',
        companyId,
        {
          requestId,
          reason:
            parsed.data.reason,
          mode: 'direct'
        }
      );

      return c.json({
        ok: true,
        status: 'approved',
        direct: true
      });
    }

    /*
     * Company Admin exists:
     * create pending access request.
     */
    await c.env.DB
      .prepare(`
        INSERT INTO company_access_requests(
          id,
          super_admin_user_id,
          company_id,
          reason
        )
        VALUES(?,?,?,?)
      `)
      .bind(
        requestId,
        c.get('session')!
          .platformUserId,
        companyId,
        parsed.data.reason
      )
      .run();

    await c.env.DB
      .prepare(`
        INSERT INTO notifications(
          id,
          company_id,
          user_id,
          title_ar,
          body_ar,
          type
        )
        VALUES(
          ?,
          ?,
          ?,
          ?,
          ?,
          'company_access'
        )
      `)
      .bind(
        crypto.randomUUID(),
        companyId,
        admin.id,
        'طلب دخول إلى بيئة الشركة',
        'مدير المنصة يطلب الوصول إلى بيئة شركتكم للمراجعة والدعم.'
      )
      .run();

    await audit(
      c,
      'company_access_request',
      'company_access_request',
      requestId,
      {
        reason:
          parsed.data.reason
      }
    );

    return c.json({
      ok: true,
      status: 'pending',
      requestId
    });
  }
);


/* =========================================================
   ACCESS REQUEST STATUS
   ========================================================= */

app.get(
  '/access-requests/:requestId',
  requireSuperAdmin,
  async c => {

    const row =
      await c.env.DB
        .prepare(`
          SELECT
            r.*,
            c.company_identifier,
            c.display_name,
            pu.display_name AS super_admin_name
          FROM company_access_requests r
          JOIN companies c
            ON c.id=r.company_id
          JOIN platform_users pu
            ON pu.id=r.super_admin_user_id
          WHERE r.id=?
            AND r.super_admin_user_id=?
        `)
        .bind(
          c.req.param('requestId'),
          c.get('session')!
            .platformUserId
        )
        .first<any>();

    if (!row) {
      return c.json(
        { error: 'NOT_FOUND' },
        404
      );
    }

    if (
      row.status === 'approved' &&
      row.expires_at &&
      new Date(
        row.expires_at
      ).getTime() > Date.now() &&
      !getCookie(
        c.req.header('Cookie'),
        'hr_company_access'
      )
    ) {
      await createCompanyAccessSession(
        c,
        c.req.param('requestId'),
        c.get('session')!
          .platformUserId!,
        row.company_id
      );

      await audit(
        c,
        'company_access_started',
        'company',
        row.company_id,
        {
          requestId: row.id,
          reason: row.reason,
          mode: 'approved'
        }
      );
    }

    if (
      row.status === 'approved' &&
      row.expires_at &&
      new Date(
        row.expires_at
      ).getTime() <= Date.now()
    ) {
      await c.env.DB
        .prepare(`
          UPDATE company_access_requests
          SET
            status='expired'
          WHERE id=?
            AND status='approved'
        `)
        .bind(row.id)
        .run();

      row.status = 'expired';
    }

    return c.json({
      request: row
    });
  }
);


/* =========================================================
   COMPANY ACCESS REQUESTS
   ========================================================= */

app.get(
  '/company-access-requests',
  requireCompanyUser,
  async c => {

    if (
      !(await hasPermission(
        c,
        'company_access.review'
      ))
    ) {
      return c.json(
        { error: 'FORBIDDEN' },
        403
      );
    }

    const rows =
      await c.env.DB
        .prepare(`
          SELECT
            r.id,
            r.requested_at,
            r.expires_at,
            r.status,
            r.reason,
            pu.display_name AS super_admin_name,
            c.company_identifier,
            c.display_name
          FROM company_access_requests r
          JOIN platform_users pu
            ON pu.id=r.super_admin_user_id
          JOIN companies c
            ON c.id=r.company_id
          WHERE r.company_id=?
            AND r.status='pending'
          ORDER BY r.requested_at DESC
        `)
        .bind(
          c.get('session')!
            .activeCompanyId
        )
        .all();

    return c.json({
      items: rows.results
    });
  }
);


/* =========================================================
   COMPANY ACCESS DECISION
   ========================================================= */

app.post(
  '/company-access-requests/:requestId/decision',
  requireCompanyUser,
  async c => {

    if (
      !(await hasPermission(
        c,
        'company_access.review'
      ))
    ) {
      return c.json(
        { error: 'FORBIDDEN' },
        403
      );
    }

    const decision = z.object({
      decision: z.enum([
        'allow',
        'reject'
      ])
    }).safeParse(
      await c.req.json().catch(
        () => null
      )
    );

    if (!decision.success) {
      return c.json(
        { error: 'INVALID_INPUT' },
        400
      );
    }

    const req =
      await c.env.DB
        .prepare(`
          SELECT *
          FROM company_access_requests
          WHERE id=?
            AND company_id=?
            AND status='pending'
        `)
        .bind(
          c.req.param('requestId'),
          c.get('session')!
            .activeCompanyId
        )
        .first<any>();

    if (!req) {
      return c.json(
        {
          error:
            'NOT_FOUND_OR_DECIDED'
        },
        404
      );
    }

    if (
      decision.data.decision === 'allow'
    ) {

      const expires =
        new Date(
          Date.now() +
          60 * 60 * 1000
        ).toISOString();

      await c.env.DB
        .prepare(`
          UPDATE company_access_requests
          SET
            status='approved',
            approved_at=CURRENT_TIMESTAMP,
            approved_by=?,
            expires_at=?
          WHERE id=?
        `)
        .bind(
          c.get('session')!
            .companyUserId,
          expires,
          req.id
        )
        .run();

      await audit(
        c,
        'company_access_approved',
        'company_access_request',
        req.id,
        {},
        {
          type: 'company',
          companyUserId:
            c.get('session')!
              .companyUserId,
          companyId:
            req.company_id
        }
      );

    } else {

      await c.env.DB
        .prepare(`
          UPDATE company_access_requests
          SET
            status='rejected',
            rejected_at=CURRENT_TIMESTAMP,
            approved_by=?
          WHERE id=?
        `)
        .bind(
          c.get('session')!
            .companyUserId,
          req.id
        )
        .run();

      await audit(
        c,
        'company_access_rejected',
        'company_access_request',
        req.id,
        {},
        {
          type: 'company',
          companyUserId:
            c.get('session')!
              .companyUserId,
          companyId:
            req.company_id
        }
      );
    }

    return c.json({
      ok: true,
      status:
        decision.data.decision ===
        'allow'
          ? 'approved'
          : 'rejected'
    });
  }
);


/* =========================================================
   EXIT COMPANY
   ========================================================= */

app.post(
  '/exit-company',
  requireSuperAdmin,
  async c => {

    const s =
      c.get('session')!;

    if (!s.activeCompanyId) {
      return c.json({
        ok: true
      });
    }

    const accessRaw =
      getCookie(
        c.req.header('Cookie'),
        'hr_company_access'
      );

    let requestId:
      string | null = null;

    if (accessRaw) {

      const hash =
        await sha256(accessRaw);

      const access =
        await c.env.DB
          .prepare(`
            SELECT request_id
            FROM company_access_sessions
            WHERE token_hash=?
              AND super_admin_user_id=?
              AND company_id=?
          `)
          .bind(
            hash,
            s.platformUserId,
            s.activeCompanyId
          )
          .first<{
            request_id:
              string | null
          }>();

      requestId =
        access?.request_id ?? null;

      await c.env.DB
        .prepare(`
          UPDATE company_access_sessions
          SET revoked_at=CURRENT_TIMESTAMP
          WHERE token_hash=?
            AND super_admin_user_id=?
        `)
        .bind(
          hash,
          s.platformUserId
        )
        .run();
    }

    if (requestId) {
      await c.env.DB
        .prepare(`
          UPDATE company_access_requests
          SET
            status='revoked',
            revoked_at=CURRENT_TIMESTAMP
          WHERE id=?
            AND status='approved'
        `)
        .bind(requestId)
        .run();
    }

    await audit(
      c,
      'company_access_exit',
      'company',
      s.activeCompanyId,
      {}
    );

    await revokeCompanyAccess(c);

    return c.json({
      ok: true
    });
  }
);


/* =========================================================
   PLATFORM SECURITY CONTROLS
   ========================================================= */

/*
 * Logs every user out without deleting accounts or business data.
 * The Super Admin can then sign in again normally.
 */
app.post(
  '/security/logout-all',
  requireSuperAdmin,
  async c => {
    await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE sessions
        SET revoked_at=CURRENT_TIMESTAMP
        WHERE revoked_at IS NULL
      `),
      c.env.DB.prepare(`
        UPDATE company_access_sessions
        SET revoked_at=CURRENT_TIMESTAMP
        WHERE revoked_at IS NULL
      `)
    ]);

    await audit(
      c,
      'logout_all',
      'security',
      null,
      { scope: 'all_sessions' }
    );

    return c.json({ ok:true });
  }
);

/*
 * Destructive reset:
 * - keeps the platform Super Admin account
 * - keeps the system permission catalogue
 * - removes companies, company users, roles, employees,
 *   organization data, notifications, access requests,
 *   sessions and audit history
 * - removes any other platform user
 *
 * A password + exact confirmation phrase are required.
 */
const cleanAllDataSchema=z.object({
  currentPassword:z.string().min(1).max(256),
  confirmation:z.literal('CLEAN_ALL_DATA')
});

app.post(
  '/security/clean-all-data',
  requireSuperAdmin,
  async c => {
    const s=c.get('session')!;
    const current=await c.env.DB.prepare(`
      SELECT id,username,password_hash,status
      FROM platform_users
      WHERE id=?
      LIMIT 1
    `).bind(s.platformUserId).first<any>();

    if(!current || current.username!=='superadmin' || current.status!=='active'){
      return c.json({error:'SUPER_ADMIN_REQUIRED'},403);
    }

    const parsed=cleanAllDataSchema.safeParse(
      await c.req.json().catch(()=>null)
    );
    if(!parsed.success) return c.json({error:'INVALID_CONFIRMATION'},400);

    if(!(await verifyPassword(parsed.data.currentPassword,current.password_hash))){
      return c.json({error:'INVALID_CREDENTIALS'},401);
    }

    const preservedSessionId=s.sessionId;

    /*
     * Delete in FK-safe order. Permissions are system definitions,
     * so they remain available for future companies.
     */
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM notifications`),
      c.env.DB.prepare(`DELETE FROM user_permissions`),
      c.env.DB.prepare(`DELETE FROM user_roles`),
      c.env.DB.prepare(`DELETE FROM role_permissions`),
      c.env.DB.prepare(`DELETE FROM company_access_sessions`),
      c.env.DB.prepare(`DELETE FROM company_access_requests`),
      c.env.DB.prepare(`DELETE FROM sessions WHERE id<>?`).bind(preservedSessionId),
      c.env.DB.prepare(`DELETE FROM audit_logs`),
      c.env.DB.prepare(`DELETE FROM employees`),
      c.env.DB.prepare(`DELETE FROM organization_units`),
      c.env.DB.prepare(`DELETE FROM company_users`),
      c.env.DB.prepare(`DELETE FROM roles`),
      c.env.DB.prepare(`DELETE FROM companies`),
      c.env.DB.prepare(`DELETE FROM platform_users WHERE id<>?`).bind(current.id)
    ]);

    /*
     * The audit trail was intentionally cleared as part of the reset.
     * Keep the database clean; the Super Admin account itself remains.
     */
    return c.json({
      ok:true,
      preserved:{
        superAdmin:true,
        systemPermissions:true,
        currentSession:true
      }
    });
  }
);

export default app;
