import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JsonWebTokenError, JwtService, TokenExpiredError } from '@nestjs/jwt';
import { UserService } from 'src/modules/user/user.service';
import {
  ActiveAccount,
  ChangeAcount,
  LoginDto,
  UserInfo,
} from './dto/create-auth.dto';
import { ConfigService } from '@nestjs/config';
import { compareSync } from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { User } from 'src/modules/user/entities/user.entity';
import { Customer } from 'src/modules/customers/entities/customer.entity';
import { CustomersService } from 'src/modules/customers/customers.service';
import { RoleEnum } from 'src/constants/role.enum';
import { Role } from 'src/modules/role/entities/role.entity';
import refreshJwtConfig from 'src/config/refresh-jwt.config';
import {
  BaseProfile,
  BaseUser,
  ForgotPassword,
  GenerateCodeActivationRegisterValidation,
  LoginConfig,
  UserResponse,
  ValidateConfig,
  VerifyResetPassword,
} from '../types/auth-validate.type';
import { Permission } from 'src/modules/permission/entities/permission.entity';
import { generateUUIDV4 } from 'src/helpers/utils';
import { CustomMailService } from 'src/modules/mail/mail.service';
import appConfig, { APP_CONFIG_TOKEN, AppConfig } from 'src/config/app.config';
import {
  generateResetToken,
  hashPasswordFunc,
} from 'src/helpers/login-security.utils';
import { ResetPassword } from '../types/auth-validate.type';
import { ResponseFunc } from '../types/api-response.type';
import { ISendMailOptions } from '@nestjs-modules/mailer';
import { getExpireMinutes } from 'src/helpers/datetime.format';
import { ProfileFacebook } from 'src/types/facebook-oaut.type';
import { Response } from 'express';
@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private CustomersService: CustomersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private readonly mailerService: CustomMailService,

    @Inject(refreshJwtConfig.KEY)
    private refreshJwtTokenConfig: ConfigType<typeof refreshJwtConfig>,

    @InjectRepository(User)
    private usersRepository: Repository<User>,

    @InjectRepository(Customer)
    private CustomerRepository: Repository<Customer>,

    @InjectRepository(Role)
    private RoleRepository: Repository<Role>,
  ) {}

  private isAdmin = (user: BaseUser): user is User => {
    return Array.isArray(user.Roles);
  };

  private isCustomer = (user: BaseUser): user is Customer => {
    return !Array.isArray(user.Roles) && !!user.Roles;
  };

  private generateTokenAndResponse = async (
    user: BaseUser,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    user: UserResponse;
  }> => {
    let roleName: RoleEnum;
    let permissions: Permission[];
    const isCustomer = this.isCustomer(user);
    const isAdmin = this.isAdmin(user);
    if (isAdmin) {
      roleName = user.Roles[0].name;
      permissions = user.Roles[0].permissions;
    } else if (isCustomer) {
      roleName = user.Roles.name;
      permissions = user.Roles.permissions;
    } else {
      throw new Error('Tài khoản có role không hợp lệ');
    }

    const accessPayload = {
      username: user.username,
      email: user.email,
      id: user.id,
      role: roleName,
    };

    const refreshPayload = {
      id: user.id,
      email: user.email,
      role: roleName,
      username: user.username,
    };

    const userResponse: UserResponse = {
      userId: user.id,
      username: user.username,
      email: user.email,
      Roles: roleName,
      avatarUrl: user.avatarUrl,
      age: user.age,
      gender: user.gender,
      permissions: permissions,
      isActice: user.isActice,
      phoneNumber: user.phoneNumber,
    };

    if (isAdmin) {
      userResponse.address = user.address;
    } else {
      userResponse.birthday = user.birthday;
    }

    const access_token = this.jwtService.sign(accessPayload);
    const refresh_token = this.jwtService.sign(
      refreshPayload,
      this.refreshJwtTokenConfig,
    );

    return { access_token, refresh_token, user: userResponse };
  };

  // Hàm trung gian: Xử lý xác thực (Google, Facebook, getAccountAdmin)
  private handleValidation = async <T extends BaseProfile>(
    profile: T,
    config: ValidateConfig = {
      createIfNotExists: false,
      isGenerateToken: false,
    },
  ): Promise<
    | {
        access_token: string;
        refresh_token: string;
        user: UserResponse;
      }
    | User
    | Customer
  > => {
    const { email, picture, gender } = profile;
    const getFullName = (profile, fallback = email) => {
      const { firstName, middleName, lastName } = profile || {};
      const parts = [lastName, middleName, firstName]
        .map((s) => s?.trim())
        .filter((s) => s);
      return parts.length > 0 ? parts.join(' ') : fallback;
    };
    const username = getFullName(profile, email);
    let user: User | Customer;

    // Kiểm tra người dùng
    if (config.isAdmin) {
      user = await this.userService.getUser1(email);
    } else {
      user = await this.CustomersService.getCustomerByEmail(email);
    }

    // Tạo người dùng mới nếu cần (cho Google/Facebook)
    if (!user && config.createIfNotExists) {
      await this.CustomerRepository.manager.transaction(async (manager) => {
        const role_user = await manager.findOne(Role, {
          where: { name: RoleEnum.USER },
        });
        user = manager.create(Customer, {
          email,
          username: username,
          Roles: role_user,
          avatarUrl: picture ? picture : null,
          isActice: true,
          gender: gender as 'male' | 'female' | 'other' | null,
        });
        await manager.save<Customer>(user);
      });
    }

    if (!user) {
      throw new UnauthorizedException('Email không chính xác');
    }

    if (!user.isActice) {
      throw new UnauthorizedException('Tài khoản chưa được kích hoạt');
    }

    // Sinh token và response
    if (config.isGenerateToken)
      return await this.generateTokenAndResponse(user);
    else return user;
  };

  async verifyActivationCode(
    dataActive: ActiveAccount,
    config: ValidateConfig = { isAdmin: true },
  ) {
    try {
      const { codeId, id } = dataActive;
      if (!codeId || !id) {
        throw new BadRequestException('Thiếu codeId hoặc id của tài khoản');
      }

      const user = config.isAdmin
        ? await this.userService.findOne({ id, codeId })
        : await this.CustomersService.findOne({ id, codeId });

      if (!user) {
        throw new BadRequestException('Mã kích hoạt không chính xác');
      }

      if (dayjs().isAfter(user.codeExprided)) {
        throw new BadRequestException(
          'Mã kích hoạt đã hết hạn. Vui lòng yêu cầu mã mới!',
        );
      }

      return {
        status: 200,
        message: 'Mã hợp lệ, bạn có thể kích hoạt tài khoản',
        data: { id, codeId },
      };
    } catch (error) {
      throw error;
    }
  }

  // Hàm trung gian: Xử lý đăng nhập (login, loginAdmin)
  async handleLogin(
    userInfo: LoginDto,
    config: LoginConfig = {},
  ): Promise<{
    access_token: string;
    refresh_token: string;
    user: UserResponse;
  }> {
    try {
      const { email, password } = userInfo;
      let user: User | Customer;

      // Kiểm tra người dùng
      if (config.isAdmin) {
        user = await this.userService.getUser1(email);
      } else {
        user = await this.CustomersService.getCustomerByEmail(email);
      }
      if (!user) {
        throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
      }
      if (!user.password) {
        if (!password) {
          throw new BadRequestException(
            'Tài khoản của bạn được tạo qua Google. Vui lòng nhập mật khẩu để đặt lần đầu và tiếp tục đăng nhập.',
          );
        }
        const hashedPassword = hashPasswordFunc({
          password,
        });
        user.password = hashedPassword;
        if (config.isAdmin) {
          await this.usersRepository.update((user as User).id, {
            password: hashedPassword,
          });
        } else {
          await this.CustomerRepository.update((user as Customer).id, {
            password: hashedPassword,
          });
        }
        return await this.generateTokenAndResponse(user);
      }
      const isPasswordValid = compareSync(password, user.password);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
      }

      // Kiểm tra trạng thái kích hoạt
      if (!user.isActice) {
        throw new UnauthorizedException('Tài khoản chưa được kích hoạt');
      }

      // Sinh token và response
      return await this.generateTokenAndResponse(user);
    } catch (e) {
      console.error('Login Failed: ', e);
      throw e;
    }
  }

  // login customer
  async login(userInfo: LoginDto) {
    try {
      return await this.handleLogin(userInfo, {
        isAdmin: false,
      });
    } catch (error) {
      console.error('user đăng nhập bị lỗi: ', error);
      throw error;
    }
  }
  // login admin
  async loginAdmin(userInfo: LoginDto) {
    try {
      return await this.handleLogin(userInfo, { isAdmin: true });
    } catch (error) {
      console.error('Có lỗi xảy ra với admin đăng nhập: ', error);
      throw error;
    }
  }

  async refreshAccessToken(req: any, config?: ValidateConfig) {
    try {
      const { email } = req;
      const resValidate = await this.handleValidation(
        { email } as BaseProfile,
        {
          isAdmin: config?.isAdmin ?? this.isAdmin(req),
        },
      );

      const { access_token } = resValidate as { access_token: string };
      return { access_token };
    } catch (error) {
      console.error('Lỗi khi refresh lại access token', error);
      if (error instanceof TokenExpiredError) {
        throw new UnauthorizedException('Refresh token đã hết hạn');
      }
      if (error instanceof JsonWebTokenError) {
        throw new UnauthorizedException('Refresh token không hợp lệ');
      }
      throw new Error('Không thể refresh token, vui lòng thử lại sau');
    }
  }

  private generateActivationCode({
    length = 4,
    expireInMinutes = 5,
  }: GenerateCodeActivationRegisterValidation = {}) {
    return {
      codeId: generateUUIDV4().slice(0, length),
      codeExprided: dayjs().add(expireInMinutes, 'minutes').toDate(),
    };
  }

  private async sendMail({
    to,
    subject = 'Kích hoạt tài khoản',
    context,
    template = './register',
  }: ISendMailOptions) {
    const { message, success } = await this.mailerService.sendMailFunc({
      to,
      subject,
      context,
      template,
    });
    if (!success) {
      throw new Error(message);
    }
  }

  async register(
    userInfo: UserInfo,
    config: ValidateConfig = { isAdmin: true },
  ) {
    const { password, email } = userInfo;
    const user: User | Customer = config?.isAdmin
      ? await this.userService.getUser1(email)
      : await this.CustomersService.getCustomerByEmail(email);
    if (user) {
      throw new BadRequestException('Email đã được sử dụng');
    }

    try {
      const result = await this.CustomerRepository.manager.transaction(
        async (manager) => {
          const { codeId, codeExprided } = this.generateActivationCode();
          const role = config.isAdmin ? RoleEnum.ADMIN : RoleEnum.USER;
          const roleEntity = await this.RoleRepository.findOne({
            where: { name: role },
          });
          let savedEntity: any;
          if (config?.isAdmin) {
            const userData: DeepPartial<User> = {
              ...userInfo,
              password: hashPasswordFunc({ password }),
              codeId,
              codeExprided,
              Roles: [roleEntity],
            };
            savedEntity = await manager.save(manager.create(User, userData));
          } else {
            const customerData: DeepPartial<Customer> = {
              ...userInfo,
              password: hashPasswordFunc({ password }),
              codeId,
              codeExprided,
              Roles: roleEntity,
            };
            savedEntity = await manager.save(
              manager.create(Customer, customerData),
            );
          }
          const activationLink = config.isAdmin
            ? `${appConfig().FE_URL_ADMIN}/verify-code?codeId=${codeId}&id=${savedEntity.id}`
            : `${appConfig().FE_URL_USER}/verify-code?codeId=${codeId}&id=${savedEntity.id}`;
          await this.sendMail({
            to: email,
            subject: 'Kích hoạt tài khoản',
            template: './register',
            context: {
              name: userInfo.username ?? email,
              activationCode: codeId,
              codeExpire: getExpireMinutes(codeExprided),
              activationLink: activationLink,
              isAdmin: config?.isAdmin,
            },
          });

          const result = config?.isAdmin
            ? await manager.save(manager.create(User, savedEntity))
            : await manager.save(manager.create(Customer, savedEntity));

          return result;
        },
      );

      return {
        status: 201,
        message: 'Đăng ký thành công! Vui lòng kiểm tra email.',
        data: {
          id: result.id,
        },
      };
    } catch (error) {
      console.error('Lỗi xảy ra khi đăng kí tài khoản: ', error);
      throw new Error('Đăng ký không thành công, vui lòng thử lại sau');
    }
  }
  async handleActive(
    dataActive: ActiveAccount,
    config: ValidateConfig = { isAdmin: true },
  ) {
    try {
      const { codeId, id } = dataActive;

      if (!id || !codeId) {
        throw new Error('Thiếu codeId hoặc id của tài khoản');
      }

      const user = config.isAdmin
        ? await this.userService.findOne({
            id,
            codeId,
          })
        : await this.CustomersService.findOne({
            id: id,
            codeId: codeId,
          });

      if (!user) {
        throw new BadRequestException(`Mã kích hoạt không chính xác`);
      }
      const isBeforeCheck = dayjs().isBefore(user.codeExprided);
      if (!isBeforeCheck) {
        throw new BadRequestException(
          'Đã hết hạn mã code. Vui lòng kích hoạt lại mã mới! ',
        );
      }
      const repo = config.isAdmin
        ? this.usersRepository
        : this.CustomerRepository;
      await repo.update(
        { id },
        {
          codeId: null,
          codeExprided: null,
          isActice: true,
        },
      );

      return {
        status: 200,
        message: 'Kích hoạt tài khoản thành công',
        data: null,
      };
    } catch (error) {
      console.error('Lỗi xảy ra khi xử lý kích hoạt tài khoản: ', error);
      throw error;
    }
  }

  async retryActive(email: string, config: ValidateConfig = { isAdmin: true }) {
    try {
      const user = config.isAdmin
        ? await this.userService.findUserbyEmail({ email })
        : await this.CustomerRepository.findOne({ where: { email } });

      if (!user) {
        throw new BadRequestException('email không tồn tại');
      }
      const { codeId, codeExprided } = this.generateActivationCode();

      const activationLink = config.isAdmin
        ? `${appConfig().FE_URL_ADMIN}/verify-code?codeId=${codeId}&id=${user.id}`
        : `${appConfig().FE_URL_USER}/verify-code?codeId=${codeId}&id=${user.id}`;
      await this.sendMail({
        to: user.email,
        subject: 'Lấy lại mã kích hoạt tài khoản tại minhdeptrai.site',
        template: './register',
        context: {
          name: user.username ?? user.email,
          activationCode: codeId,
          codeExpire: getExpireMinutes(codeExprided),
          activationLink: activationLink,
          isAdmin: config?.isAdmin,
        },
      });
      const repo = config.isAdmin
        ? this.usersRepository
        : this.CustomerRepository;

      await repo.update({ email }, { codeId, codeExprided });

      return {
        status: 200,
        message: 'Lấy lại mã kích hoạt thành công. Vui lòng kiểm tra gmail',
        data: {
          id: user.id,
        },
      };
    } catch (error) {
      console.error('Lỗi xảy ra khi lấy lại mã kích hoạt tài khoản: ', error);
      throw error;
    }
  }

  async retryPassword(email: string) {
    try {
      const user = await this.CustomerRepository.findOne({ where: { email } });

      if (!user) {
        throw new BadRequestException('Không tồn tại user');
      }

      const { codeId, codeExprided } = this.generateActivationCode();

      await this.sendMail({
        to: user.email,
        subject: 'Lấy mã kích hoạt quên mật khẩu',
        template: './register',
        context: {
          name: user.username ?? user.email,
          activationCode: codeId,
          codeExpire: getExpireMinutes(codeExprided),
        },
      });

      // Cập nhật lại thông tin user
      await this.CustomerRepository.update(
        { email },
        {
          codeId: codeId,
          codeExprided: codeExprided,
        },
      );

      // Trả email
      return {
        id: user.id,
        email: user.email,
      };
    } catch (error) {
      console.error(
        'Lỗi xảy ra khi lấy lại mã kích hoạt quên mật khẩu: ',
        error,
      );
      throw error;
    }
  }
  async changePassword(dataActive: ChangeAcount) {
    const { email, password, confirmpassword, codeId } = dataActive;
    // Kiểm tra xem người dùng có tồn tại không, tìm cả theo email và codeId
    const existingUser = await this.CustomersService.findUserbyEmailAndCodeId({
      email,
      codeId,
    });

    if (!existingUser) {
      throw new BadRequestException(
        'Mã code không chính xác, vui lòng kiểm tra lại hộp thử',
      );
    }

    // Kiểm tra mật khẩu và xác nhận mật khẩu
    if (password !== confirmpassword) {
      throw new BadRequestException('Mật khẩu và xác nhận mật khẩu không khớp');
    }
    // hash
    const hash = hashPasswordFunc({ password });
    try {
      const isBeforeCheck = dayjs().isBefore(existingUser.codeExprided);
      if (!isBeforeCheck) {
        throw new BadRequestException(
          'Đã hết hạn mã code. Vui lòng kích hoạt lại mã mới!',
        );
      }
      await this.CustomerRepository.update(
        { email },
        {
          password: hash,
          codeId: null,
          codeExprided: null,
        },
      );

      return {
        status: 200,
        message: 'Mật khẩu đã được thay đổi thành công',
        data: null,
      };
    } catch (error) {
      throw error;
    }
  }

  async retryPasswordAdmin(email: string) {
    const user = await this.usersRepository.findOne({ where: { email } });

    if (!user) {
      throw new BadRequestException('Không tồn tại user');
    }

    const codeId = uuidv4();

    // Cập nhật lại thông tin user
    await this.usersRepository.update(
      { email },
      {
        codeId: codeId.slice(0, 4),
        codeExprided: dayjs().add(5, 'minutes').toDate(),
      },
    );

    // // send email
    // this.mailerService.sendMail({
    //   to: user.email, // list of receivers
    //   from: 'ngodinhphuoc100@gmail.com', // sender address
    //   subject: 'Retry Active your Account at minhdeptrai.site ✔', // Subject line

    //   template: './register',
    //   context: {
    //     name: user.username ?? user.email,
    //     activationCode: codeId.slice(0, 4),
    //   },
    // });

    // Trả email
    return {
      id: user.id,
      email: user.email,
    };
  }
  async changePasswordAdmin(dataActive: ChangeAcount) {
    const { email, password, confirmpassword, codeId } = dataActive;
    // Kiểm tra xem người dùng có tồn tại không, tìm cả theo email và codeId
    const existingUser = await this.userService.findUserbyEmailAndCodeId({
      email,
      codeId,
    });

    if (!existingUser) {
      return {
        message: 'Email hoặc codeId không tồn tại',
      };
    }

    // Kiểm tra mật khẩu và xác nhận mật khẩu
    if (password !== confirmpassword) {
      // Nếu mật khẩu và xác nhận mật khẩu không khớp
      return {
        message: 'Mật khẩu và xác nhận mật khẩu không khớp',
      };
    }
    // hash
    const hash = hashPasswordFunc({ password });
    try {
      const isBeforeCheck = dayjs().isBefore(existingUser.codeExprided);
      if (isBeforeCheck) {
        await this.CustomerRepository.update(
          { email },
          {
            password: hash, // Cập nhật mật khẩu đã được hash
          },
        );
      } else {
        throw new BadRequestException(
          'Đã hết hạn mã code.Vui lòng resend email lại để lấy mã mới! ',
        );
      }

      return {
        message: 'Mật khẩu đã được thay đổi thành công',
      };
    } catch (error) {
      // Xử lý lỗi nếu có
      return {
        message: 'Đã có lỗi xảy ra khi cập nhật mật khẩu',
      };
    }
  }

  async validateGoogleUser(
    profile: any,
    config: ValidateConfig = {
      createIfNotExists: true,
      isGenerateToken: true,
      isAdmin: false,
    },
  ) {
    try {
      return (await this.handleValidation(profile, config)) as {
        access_token: string;
        refresh_token: string;
        user: UserResponse;
      };
    } catch (error) {
      console.error('Lỗi xác thực người dùng google: ', error);
      throw error;
    }
  }

  async validateFacebookUser(
    profile: ProfileFacebook,
    config: ValidateConfig = {
      createIfNotExists: true,
      isGenerateToken: true,
      isAdmin: false,
    },
  ) {
    try {
      const { email, firstName, lastName, middleName, profileUrl, gender } =
        profile;
      return (await this.handleValidation(
        {
          email,
          firstName,
          lastName,
          middleName,
          picture: profileUrl,
          gender,
        },
        config,
      )) as {
        access_token: string;
        refresh_token: string;
        user: UserResponse;
      };
    } catch (error) {
      console.error('Lỗi xác thực người dùng google: ', error);
      throw error;
    }
  }

  // async sendMailAdmin_ResponseCustomer(infoContact_OfCustomer) {
  //   const emailAdmin = 'ngodinhphuoc100@gmail.com';
  //   this.mailerService.sendMail({
  //     to: emailAdmin, // list of receivers
  //     from: 'noreply@nestjs.com', // sender address
  //     subject: 'Thông tin báo giá từ khách hàng minhdeptrai.site ✔', // Subject line

  //     template: './contactPrice',
  //     context: {
  //       name: infoContact_OfCustomer.name ?? infoContact_OfCustomer?.email,
  //       email: infoContact_OfCustomer?.email,
  //       phone: infoContact_OfCustomer?.phone,
  //       note: infoContact_OfCustomer?.note,
  //     },
  //   });

  //   this.mailerService.sendMail({
  //     to: infoContact_OfCustomer.email, // list of receivers
  //     from: 'noreply@nestjs.com', // sender address
  //     subject: 'Phản Hồi Đến Khách Hàng minhdeptrai.site ✔', // Subject line

  //     template: './thankyou',
  //     context: {
  //       name: infoContact_OfCustomer.name ?? infoContact_OfCustomer?.email,
  //     },
  //   });
  //   return infoContact_OfCustomer;
  // }

  async forgotPassword({
    email,
    config = { isAdmin: true },
  }: ForgotPassword): Promise<ResponseFunc> {
    try {
      return await this.usersRepository.manager.transaction(async (manager) => {
        const user = (await this.handleValidation(
          { email },
          { isAdmin: config.isAdmin, isGenerateToken: false },
        )) as User | Customer;

        const appConfig = this.configService.get<AppConfig>(APP_CONFIG_TOKEN);
        const { token, expires } = generateResetToken(user.id);
        let resetPasswordUrl: string;
        if (user instanceof Customer)
          resetPasswordUrl = `${appConfig.FE_URL_USER}/reset-password?token=${token}`;
        else
          resetPasswordUrl = `${appConfig.FE_URL_ADMIN}/reset-password?token=${token}`;
        const { success, message } = await this.mailerService.sendMailFunc({
          to: email,
          subject: 'Quên mật khẩu',
          context: {
            name: user.username,
            resetPasswordUrl: resetPasswordUrl,
          },
          template: './forgotPassword',
        });

        user.codeId = token;
        user.codeExprided = expires;
        await manager.save(user);
        return {
          status: success,
          data: null,
          message: message,
        };
      });
    } catch (error) {
      throw error;
    }
  }
  async verifyResetPasswordToken({
    token,
    config = { isAdmin: true },
  }: VerifyResetPassword): Promise<ResponseFunc<User | Customer | undefined>> {
    try {
      let user: User | Customer;
      if (config.isAdmin)
        user = await this.usersRepository.findOne({
          where: {
            codeId: token,
          },
        });
      else
        user = await this.CustomerRepository.findOne({
          where: { codeId: token },
        });
      if (
        !user ||
        !user.codeExprided ||
        Date.now() > user.codeExprided.getTime()
      ) {
        return { status: 400, message: 'Token không hợp lệ hoặc đã hết hạn' };
      }
      return { status: 200, message: 'Token hợp lệ', data: user };
    } catch (error) {
      console.error('Xác thực token reset password lỗi', error);
      return { status: 400, message: 'Có lỗi xảy ra. Vui lòng thử lại sau' };
    }
  }
  async resetPassword({
    token,
    newPassword,
    config = { isAdmin: true },
  }: ResetPassword): Promise<ResponseFunc> {
    try {
      let user: Customer | User | undefined;
      user = (
        await this.verifyResetPasswordToken({
          token: token,
          config: { isAdmin: config.isAdmin },
        })
      )?.data;
      if (!user)
        throw new UnauthorizedException('User hoặc token không hợp lệ');
      const hashedPassword = hashPasswordFunc({ password: newPassword });
      await this.usersRepository.manager.transaction(async (manager) => {
        user.password = hashedPassword;
        user.codeId = null;
        user.codeExprided = null;
        await manager.save(user);
      });

      return {
        status: 200,
        message: 'Mật khẩu đã được đặt lại thành công',
      };
    } catch (error) {
      throw error;
    }
  }
}
